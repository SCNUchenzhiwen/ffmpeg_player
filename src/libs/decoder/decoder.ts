/* eslint-disable */

export const ACTION_TYPE_INIT = "ACTION_TYPE_INIT";
export const ACTION_TYPE_DECODE = "ACTION_TYPE_DECODE";
export const ACTION_TYPE_PLAY = "ACTION_TYPE_PLAY";
export const ACTION_TYPE_FLUSH = "ACTION_TYPE_FLUSH";

const pool_size = 48;
const decodeCount = pool_size / 2;
const pool = new Map();

function loadScript(src: string) {
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => {
      resolve(true);
    };
    document.head.appendChild(script);
  });
}

declare global {
  interface Window {
    Module: {
      FS: any,
      WORKERFS: any,
      [propName: string]: any
    }
  }
}



class Decoder {
  private url: string;
  private cb: (...args: any[]) => any

  constructor() {
    this.url = "/static/decoder/mp4info.js";
    this.cb = () => {}
  }

  async init() {
    await loadScript(this.url);
  }

  initHandler({ file, startTime = 0 }: { file: any; startTime: number }) {
    const Module = window.Module;
    const { FS, MEMFS } = Module;
    // Create and mount FS work directory.
    if (!FS.analyzePath("/work").exists) {
      FS.mkdir("/work");
    }
    FS.mount(MEMFS, { files: [file] }, "/work");
    let status = "INITING";
    const setYUVDataCallback = Module.cwrap("setYUVDataCallback", null, [
      "function",
    ]);
    const onYUVData = Module.addFunction(
      (yuv_arr_addr: any, decode_count: number) => {
        const arrayOfPointers = [];
        const res = [];
        for (let i = 0; i < decode_count; i++) {
          arrayOfPointers.push(Module.HEAP32[(yuv_arr_addr >> 2) + i]);
        }
        // 读取每个结构体指针数组元素的内容
        for (let i = 0; i < arrayOfPointers.length; i++) {
          const yuvDataPtr = arrayOfPointers[i];
          const dataYPtr = Module.HEAP32[yuvDataPtr >> 2];
          const dataUPtr = Module.HEAP32[(yuvDataPtr >> 2) + 1];
          const dataVPtr = Module.HEAP32[(yuvDataPtr >> 2) + 2];
          const linesizeY = Module.HEAP32[(yuvDataPtr >> 2) + 3];
          const linesizeU = Module.HEAP32[(yuvDataPtr >> 2) + 4];
          const linesizeV = Module.HEAP32[(yuvDataPtr >> 2) + 5];
          const width = Module.HEAP32[(yuvDataPtr >> 2) + 6];
          const height = Module.HEAP32[(yuvDataPtr >> 2) + 7];
          const pts = Module.HEAP32[(yuvDataPtr >> 2) + 8];
          const playTimestamp = Module.HEAP32[(yuvDataPtr >> 2) + 9];

          const format = {
            width,
            height,
            chromaWidth: width / 2,
            chromaHeight: height / 2,
            cropLeft: 0,
            cropTop: 4,
            cropWidth: width,
            cropHeight: height,
            displayWidth: width,
            displayHeight: height,
          };
          const y = {
            bytes: Module.HEAPU8.subarray(
              dataYPtr,
              dataYPtr + linesizeY * height
            ),
            stride: linesizeY,
          };
          const u = {
            bytes: Module.HEAPU8.subarray(
              dataUPtr,
              dataUPtr + (linesizeU * height) / 2
            ),
            stride: linesizeU,
          };
          const v = {
            bytes: Module.HEAPU8.subarray(
              dataVPtr,
              dataVPtr + (linesizeV * height) / 2
            ),
            stride: linesizeV,
          };
          const buffObj = {
            format,
            y,
            u,
            v,
            playTimestamp,
          };
          res.push(buffObj);
        }
        console.timeEnd("解码---------------");
        res.sort((a, b) => a.playTimestamp - b.playTimestamp);
        res.forEach((item) => {
          pool.set(item.playTimestamp, item);
        });
        if (status === "INITING") {
          this.emit({ type: ACTION_TYPE_INIT, payload: { success: true } });
          status = "INITED";
        }
      },
      "vii"
    );
    setYUVDataCallback(onYUVData);
    Module.init_decoder("/work/" + file.name);
    this.decodeHandler(startTime);
  }

  decodeHandler(timestamp: number) {
    const Module = window.Module;
    const count = pool_size - pool.size;
    console.time("解码---------------");
    Module.handle_decode_frame(timestamp, count);
    this.emit({ type: ACTION_TYPE_DECODE, payload: {} });
  }

  playHandler(targetTimestamp: number) {
    const timestampeKeys = Array.from(pool.keys());
    let frameDetail = null;
    for (let i = 0; i < timestampeKeys.length; i++) {
      if (timestampeKeys[i] >= targetTimestamp) {
        frameDetail = pool.get(timestampeKeys[i]);
        for (let j = i; j >= 0; j--) {
          pool.delete(timestampeKeys[j]);
        }
        break;
      }
    }
    if (pool.size <= pool_size / 2) {
      const lastFrameTimestamp = pool.get(
        timestampeKeys.slice(-1)[0]
      ).playTimestamp;
      this.decodeHandler(lastFrameTimestamp + 1);
    }
    this.emit({ type: ACTION_TYPE_PLAY, payload: frameDetail });
    return frameDetail
  }
  flushHandler() {
    const Module = window.Module;
    const { FS } = Module;
    Module.flush();
    pool.clear();
    FS.unmount("/work");
    this.emit({ type: ACTION_TYPE_FLUSH, payload: {} });
  }

  on(cb: any) {
    this.cb = cb
  }

  emit(data: any) {
    this.cb(data)
  }
}

export default new Decoder()
