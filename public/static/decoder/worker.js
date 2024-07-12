/* eslint-disable */

// Run this script as a Web Worker so it doesn't block the
// browser's main thread.
// See: index.html.

const ACTION_TYPE_INIT = "ACTION_TYPE_INIT";
const ACTION_TYPE_DECODE = "ACTION_TYPE_DECODE";
const ACTION_TYPE_PLAY = "ACTION_TYPE_PLAY";
const ACTION_TYPE_FLUSH = "ACTION_TYPE_FLUSH";
const ACTION_TYPE_GET_FRAME = "ACTION_TYPE_GET_FRAME";
const ACTION_TYPE_DECODE_FRAME = "ACTION_TYPE_DECODE_FRAME";
const ACTION_TYPE_STATUS_CHANGE = "ACTION_TYPE_STATUS_CHANGE";
const ACTION_TYPE_DECODE_AUDIO_FRAME = "ACTION_TYPE_DECODE_AUDIO_FRAME";
const ACTION_TYPE_POST_FRAME = "ACTION_TYPE_POST_FRAME";
const ACTION_TYPE_FINISH_DECODE = "ACTION_TYPE_FINISH_DECODE";

const DECODE_STATUS_NOT_BEGIN = 0;
const DECODE_STATUS_DECODING = 1;
const DECODE_STATUS_PAUSE = 2;
const DECODE_STATUS_FINISH = 3;

const pool_size = 48;
const decodeCount = pool_size / 2;
const pool = new Map();

let finish = false;

let decodeStatus = DECODE_STATUS_NOT_BEGIN;

let decoding = false;

const yuvArrayPool = [];
let yuvReleaseArrayBufferPool = [];
let hasInitPool = false;
let currentDecodeYuvPlaystartTime = 0;
let currentDecodeYuvPlayEndTime = 0;
let currentPlayYuvIndex = 0;
let currentPlayYuvTimestampe = 0;

const initYuvReleaseArrayBufferPool = (linesizeY, height) => {
  yuvReleaseArrayBufferPool = [];
  for (let i = 0; i < pool_size; i++) {
    const y_buffer = new ArrayBuffer(linesizeY * height);
    const y_typeArr = new Uint8Array(y_buffer);
    const u_buffer = new ArrayBuffer((linesizeY * height) / 2);
    const u_typeArr = new Uint8Array(u_buffer);
    const v_buffer = new ArrayBuffer((linesizeY * height) / 2);
    const v_typeArr = new Uint8Array(v_buffer);
    yuvReleaseArrayBufferPool.push({
      y_typeArr,
      u_typeArr,
      v_typeArr,
    });
  }
  hasInitPool = true;
};
const initYuvArrayBufferByDecode = (linesizeY, height) => {
  if (!yuvReleaseArrayBufferPool.length && !hasInitPool) {
    initYuvReleaseArrayBufferPool(linesizeY, height);
  }
};
const clearYuvObjBuffer = (yuvObj) => {
  const { y, u, v } = yuvObj;
  yuvReleaseArrayBufferPool.unshift({
    y_typeArr: y,
    u_typeArr: u,
    v_typeArr: v,
  });
};
const clearYuvObjBufferByIndexScope = (start, end) => {
  const spliceCount = end - start;
  if (!spliceCount) return;
  const spliceArr = yuvArrayPool.splice(start, spliceCount);
  for (let i = 0; i < spliceArr.length; i++) {
    clearYuvObjBuffer(spliceArr[i]);
  }
};

const updateYuvPoolPlayTimeRang = () => {
  const startYuvItem = yuvArrayPool[0];
  const lastYuvItem = yuvArrayPool.slice(-1)[0];
  if (startYuvItem && lastYuvItem) {
    currentDecodeYuvPlaystartTime = startYuvItem.playTimestamp;
    currentDecodeYuvPlayEndTime = lastYuvItem.playTimestamp;
  }
};

const initHandler = ({ file, startTime = 0 }) => {
  const { FS, WORKERFS } = Module;
  if (!FS.analyzePath("/work").exists) {
    FS.mkdir("/work");
  }
  FS.mount(WORKERFS, { files: [file] }, "/work");
  const setDecodeStatusCallback = Module.cwrap(
    "setDecodeStatusCallback",
    null,
    ["function"]
  );
  const onDecodeStatusChange = Module.addFunction((status) => {
    console.log("解码状态---------------------------", new Date().getTime());
    console.log(status);
    decodeStatus = status;
    postMessage({ type: ACTION_TYPE_STATUS_CHANGE, payload: status });
  }, "vi");
  setDecodeStatusCallback(onDecodeStatusChange);
  const setPCMDataCallback = Module.cwrap("setPCMDataCallback", null, [
    "function",
  ]);
  const onPCMDataCallback = Module.addFunction(
    (pcm_data_addr, dataSize, audio_count, channel, sample_rate) => {
      const buffer = new Float32Array(
        Module.HEAPF32.buffer,
        pcm_data_addr,
        dataSize
      );

      const arrayBuffer = new ArrayBuffer(dataSize * 4);
      const typeBuffer = new Float32Array(arrayBuffer);
      typeBuffer.set(buffer);

      const obj = {
        data: typeBuffer,
        dataSize,
        sample_rate,
        channel,
      };
      console.log("一帧音频数据------------------------------------");
      console.log(obj);
      // postMessage({ type: ACTION_TYPE_DECODE_AUDIO_FRAME, payload: obj }, [
      //   obj.data.buffer,
      // ]);
    },
    "viiiii"
  );
  setPCMDataCallback(onPCMDataCallback);

  const setYUVDataCallback = Module.cwrap("setYUVDataCallback", null, [
    "function",
  ]);
  const onYUVData = Module.addFunction(
    (yuv_arr_addr, decode_count, last_frame) => {
      const arrayOfPointers = [];
      for (let i = 0; i < decode_count; i++) {
        arrayOfPointers.push(Module.HEAP32[(yuv_arr_addr >> 2) + i]);
      }
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

        initYuvArrayBufferByDecode(linesizeY, height);
        const releaseArrayBuffer = yuvReleaseArrayBufferPool.pop();

        const y_subBuff = Module.HEAPU8.subarray(
          dataYPtr,
          dataYPtr + linesizeY * height
        );
        releaseArrayBuffer.y_typeArr.set(y_subBuff);
        const u_subBuff = Module.HEAPU8.subarray(
          dataUPtr,
          dataUPtr + (linesizeY * height) / 2
        );
        releaseArrayBuffer.u_typeArr.set(u_subBuff);
        const v_subBuff = Module.HEAPU8.subarray(
          dataVPtr,
          dataVPtr + (linesizeY * height) / 2
        );
        releaseArrayBuffer.v_typeArr.set(v_subBuff);

        const y = {
          bytes: releaseArrayBuffer.y_typeArr,
          stride: linesizeY,
        };
        const u = {
          bytes: releaseArrayBuffer.u_typeArr,
          stride: linesizeU,
        };
        const v = {
          bytes: releaseArrayBuffer.v_typeArr,
          stride: linesizeV,
        };
        const buffObj = {
          format,
          y,
          u,
          v,
          playTimestamp,
          lastFrame: 0,
          end: i === decodeCount - 1,
        };
        // console.log('主动推送---->', new Date().getTime())
        // postMessage({ type: ACTION_TYPE_DECODE_FRAME, payload: buffObj }, [
        //   buffObj.y.bytes.buffer,
        //   buffObj.u.bytes.buffer,
        //   buffObj.v.bytes.buffer,
        // ]);
        yuvArrayPool.push(buffObj);
      }

      updateYuvPoolPlayTimeRang();

      console.log("解码帧数", decode_count);
      console.timeEnd("解码---------------");

      postMessage({ type: ACTION_TYPE_FINISH_DECODE, payload: { count: decode_count } })
    },
    "viii"
  );
  setYUVDataCallback(onYUVData);
  Module.init_decoder("/work/" + file.name);

  setTimeout(() => {
    postMessage({ type: ACTION_TYPE_INIT })
  }, 1000)
};

const decodeHandler = (count, videoStartTime = 0, audioStartTime = 0) => {
  console.time("解码---------------");
  Module.handle_decode_frame(count, videoStartTime, audioStartTime);
};

const getPlayFrame = (targetTimestamp = 0) => {
  console.time("获取帧遍历耗时")
  const hasYuvFrame =
    targetTimestamp >= currentDecodeYuvPlaystartTime &&
    targetTimestamp <= currentDecodeYuvPlayEndTime;
  if (hasYuvFrame) {
    let frameIndex = 0;
    for (let i = 0; i < yuvArrayPool.length; i++) {
      const { playTimestamp } = yuvArrayPool[i];
      if (playTimestamp >= targetTimestamp) {
        frameIndex = i;
        break;
      }
    }
    const playYuvItem = yuvArrayPool[frameIndex];
    clearYuvObjBufferByIndexScope(0, frameIndex - 1);
    console.timeEnd("获取帧遍历耗时")
    const bufferArr = []
    for (let i = frameIndex; i < yuvArrayPool.length; i++) {
      const { y, u, v } = yuvArrayPool[i]
      bufferArr.push(y.bytes.buffer)
      bufferArr.push(u.bytes.buffer)
      bufferArr.push(v.bytes.buffer)
    }
    postMessage({ type: ACTION_TYPE_POST_FRAME, payload: yuvArrayPool.slice(frameIndex) }, bufferArr);
  }
};

const flushHandler = () => {
  Module.flush();
  pool.clear();
  FS.unmount("/work");
  postMessage({ type: ACTION_TYPE_FLUSH, payload: {} });
};

onmessage = (e) => {
  const option = e.data;

  const { type, payload } = option;

  switch (type) {
    case ACTION_TYPE_INIT:
      initHandler(payload);
      break;
    case ACTION_TYPE_DECODE:
      const { count, videoStartTime, audioStartTime } = payload;
      decodeHandler(count, videoStartTime, audioStartTime);
      break;
    case ACTION_TYPE_GET_FRAME:
      getPlayFrame(payload);
      break;
    case ACTION_TYPE_FLUSH:
      flushHandler;
      break;
  }
};

self.importScripts("/static/decoder/mp4info.js");
