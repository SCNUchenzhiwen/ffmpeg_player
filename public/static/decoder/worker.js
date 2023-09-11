/* eslint-disable */

// Run this script as a Web Worker so it doesn't block the
// browser's main thread.
// See: index.html.

const ACTION_TYPE_INIT = 'ACTION_TYPE_INIT'
const ACTION_TYPE_DECODE = 'ACTION_TYPE_DECODE'
const ACTION_TYPE_PLAY = 'ACTION_TYPE_PLAY'
const ACTION_TYPE_FLUSH = 'ACTION_TYPE_FLUSH'
const ACTION_TYPE_DECODE_FRAME = 'ACTION_TYPE_DECODE_FRAME'
const ACTION_TYPE_STATUS_CHANGE = 'ACTION_TYPE_STATUS_CHANGE'

const DECODE_STATUS_NOT_BEGIN = 0
const DECODE_STATUS_DECODING = 1
const DECODE_STATUS_PAUSE = 2
const DECODE_STATUS_FINISH = 3

const pool_size = 10
const decodeCount = pool_size / 2
const pool = new Map()

let finish = false

let decodeStatus = DECODE_STATUS_NOT_BEGIN

let decoding = false

const initHandler = ({ file, startTime = 0 }) => {
    const { FS, WORKERFS } = Module
    // Create and mount FS work directory.
    if (!FS.analyzePath('/work').exists) {
        FS.mkdir('/work');
    }
    FS.mount(WORKERFS, { files: [file] }, '/work');
    status = 'INITING'
    const setDecodeStatusCallback = Module.cwrap('setDecodeStatusCallback', null, ['function'])
    const onDecodeStatusChange = Module.addFunction((status) => {
        console.log('解码状态---------------------------', new Date().getTime())
        console.log(status)
        decodeStatus = status
        postMessage({ type: ACTION_TYPE_STATUS_CHANGE, payload: status })
    }, 'vi')
    setDecodeStatusCallback(onDecodeStatusChange)
    const setYUVDataCallback = Module.cwrap('setYUVDataCallback', null, ['function'])
    const onYUVData = Module.addFunction((yuv_arr_addr, decode_count, last_frame) => {
        const arrayOfPointers = [];
        for (let i = 0; i < decode_count; i++) {
            arrayOfPointers.push(Module.HEAP32[(yuv_arr_addr >> 2) + i]);
        }
        // 读取每个结构体指针数组元素的内容
        for (let i = 0; i < arrayOfPointers.length; i++) {
            // const jpgDataPtr = arrayOfPointers[i];
            // const jpgPtr = Module.HEAP32[jpgDataPtr >> 2];
            // const buff_size = Module.HEAP32[jpgDataPtr >> 2 + 1];
            // const pts = Module.HEAP32[jpgDataPtr >> 2 + 2];
            // const play_timestamp = Module.HEAP32[jpgDataPtr >> 2 + 3];

            // const jpgData = Module.HEAPU8.subarray(jpgPtr, buff_size)

            // const buffObj = {
            //     data: jpgData,
            //     pts,
            //     play_timestamp
            // }

            // res.push(buffObj)


            const yuvDataPtr = arrayOfPointers[i];
            const dataYPtr = Module.HEAP32[yuvDataPtr >> 2];
            const dataUPtr = Module.HEAP32[(yuvDataPtr >> 2) + 1];
            const dataVPtr = Module.HEAP32[(yuvDataPtr >> 2) + 2];
            const linesizeY = Module.HEAP32[(yuvDataPtr >> 2) + 3];
            const linesizeU = Module.HEAP32[(yuvDataPtr >> 2) + 4];
            const linesizeV = Module.HEAP32[(yuvDataPtr >> 2) + 5];
            const width = Module.HEAP32[(yuvDataPtr >> 2) + 6];
            const height = Module.HEAP32[(yuvDataPtr >> 2) + 7];
            // const pts = Module.HEAP32[(yuvDataPtr >> 2) + 8];
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
                displayHeight: height
            }
            // console.log('解码推送-----', new Date().getTime())
            // const y_buffer = Module.HEAPU8.subarray(dataYPtr, dataYPtr + linesizeY * height).buffer
            // postMessage(y_buffer, [y_buffer])
            // console.log('解码转换buffer开始-----', new Date().getTime())
            const y_buffer = new ArrayBuffer(linesizeY * height)
            const y_typeArr = new Uint8Array(y_buffer)
            const y_subBuff = Module.HEAPU8.subarray(dataYPtr, dataYPtr + linesizeY * height)
            y_typeArr.set(y_subBuff)
            const u_buffer = new ArrayBuffer(linesizeY * height / 2)
            const u_typeArr = new Uint8Array(u_buffer)
            const u_subBuff = Module.HEAPU8.subarray(dataUPtr, dataUPtr + linesizeY * height / 2)
            u_typeArr.set(u_subBuff)
            const v_buffer = new ArrayBuffer(linesizeY * height / 2)
            const v_typeArr = new Uint8Array(v_buffer)
            const v_subBuff = Module.HEAPU8.subarray(dataVPtr, dataVPtr + linesizeY * height / 2)
            v_typeArr.set(v_subBuff)
            // console.log('解码转换buffer结束-----', new Date().getTime())
            // postMessage(y_buffer, [y_buffer])
            const y = {
                bytes: y_typeArr,
                stride: linesizeY
            }
            const u = {
                bytes: u_typeArr,
                stride: linesizeU
            }
            const v = {
                bytes: v_typeArr,
                stride: linesizeV
            }
            const buffObj = {
                format,
                y,
                u,
                v,
                playTimestamp,
                lastFrame: 0,
                end: i === decodeCount - 1
            }
            // console.log('主动推送---->', new Date().getTime())
            postMessage({ type: ACTION_TYPE_DECODE_FRAME, payload: buffObj }, [buffObj.y.bytes.buffer, buffObj.u.bytes.buffer, buffObj.v.bytes.buffer])
        }
        console.log('解码帧数', decode_count)
        console.timeEnd('解码---------------')
        // res.sort((a, b) => a.playTimestamp - b.playTimestamp)
        // if (last_frame) {
        //     finish = true
        //     if (res.slice(-1)[0]) {
        //         res.slice(-1)[0].lastFrame = 1
        //     }
        // }
        // res.forEach(item => {
        //     pool.set(item.playTimestamp, item)
        // })
        if (status === 'INITING') {
            postMessage({ type: ACTION_TYPE_INIT, payload: { success: true } })
            status = 'INITED'
        }
        decoding = false
    }, 'viii')
    setYUVDataCallback(onYUVData)
    Module.init_decoder('/work/' + file.name);
    decodeStatus = DECODE_STATUS_NOT_BEGIN
    decodeHandler(pool_size)
}

const decodeHandler = (count) => {
    if (decodeStatus === DECODE_STATUS_FINISH) {
        console.log('当前视频已解码了最后一帧------------>')
        return
    }
    if (decoding) {
        console.log('当前正在解码')
        return
    }
    // const count = pool_size - pool.size
    console.time('解码---------------')
    decoding = true
    Module.handle_decode_frame(count)
    postMessage({ type: ACTION_TYPE_DECODE, payload: {} })
}

const playHandler = (targetTimestamp) => {
    console.log('接收到播放消息', new Date().getTime())
    const timestampeKeys = Array.from(pool.keys())
    let frameDetail = null
    for (let i = 0; i < timestampeKeys.length; i++) {
        if (timestampeKeys[i] >= targetTimestamp) {
            frameDetail = pool.get(timestampeKeys[i])
            console.log('推送一帧--------------------->', new Date().getTime())
            postMessage({ type: ACTION_TYPE_PLAY, payload: frameDetail }, [frameDetail.y.bytes.buffer, frameDetail.u.bytes.buffer, frameDetail.v.bytes.buffer])
            for (let j = i; j >=0; j--) {
                pool.delete(timestampeKeys[j])
            }
            break
        }
    }
    if (pool.size <= pool_size / 2 && !finish) {
        // const lastFrameTimestamp = pool.get(timestampeKeys.slice(-1)[0]).playTimestamp
        decodeHandler()
    }
}

const flushHandler = () => {
    Module.flush()
    pool.clear()
    FS.unmount('/work')
    postMessage({ type: ACTION_TYPE_FLUSH, payload: {} })
}

onmessage = (e) => {
    const option = e.data;

    const { type, payload } = option

    switch(type) {
        case ACTION_TYPE_INIT:
            initHandler(payload)
            break
        case ACTION_TYPE_DECODE:
            decodeHandler(payload)
            break
        case ACTION_TYPE_PLAY:
            playHandler(payload)
            break
        case ACTION_TYPE_FLUSH:
            flushHandler
            break
    }
}

// Import the Wasm loader generated from our Emscripten build.
self.importScripts('/static/decoder/mp4info.js');
