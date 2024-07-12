import React, { FormEvent, useEffect, useRef, useLayoutEffect, useCallback, useState } from 'react'
import { initWorker, type IWorker } from './workerInstance'
import YUVCanvas from 'yuv-canvas'
import decoder from '../../libs/decoder/decoder'

import './index.css'

const ACTION_TYPE_INIT = 'ACTION_TYPE_INIT'
const ACTION_TYPE_DECODE = 'ACTION_TYPE_DECODE'
const ACTION_TYPE_PLAY = 'ACTION_TYPE_PLAY'
const ACTION_TYPE_FLUSH = 'ACTION_TYPE_FLUSH'
const ACTION_TYPE_DECODE_FRAME = 'ACTION_TYPE_DECODE_FRAME'
const ACTION_TYPE_STATUS_CHANGE = 'ACTION_TYPE_STATUS_CHANGE'
const ACTION_TYPE_DECODE_AUDIO_FRAME = 'ACTION_TYPE_DECODE_AUDIO_FRAME'
const ACTION_TYPE_FINISH_DECODE = 'ACTION_TYPE_FINISH_DECODE'
const ACTION_TYPE_GET_FRAME = "ACTION_TYPE_GET_FRAME";
const ACTION_TYPE_POST_FRAME = "ACTION_TYPE_POST_FRAME";

const DECODE_STATUS_NOT_BEGIN = 0
const DECODE_STATUS_DECODING = 1
const DECODE_STATUS_PAUSE = 2
const DECODE_STATUS_FINISH = 3

  const audioContext = new AudioContext()

const Player = () => {
  const worker = useRef<{ value: IWorker }>({ value: {} as IWorker })
  const canvas = useRef<HTMLCanvasElement>(null)
  const yuv = useRef<{ value: Record<string, any> }>({ value: {} })
  const playTimer = useRef<any>(null)
  const workerPlayCb = useRef<any>(null)
  const decodeFramePool = useRef<any[]>([])
  const framePool = useRef<any>([])
  const decodeAudioFramePool = useRef<any>([])
  const audioFramePool = useRef<any[]>([])
  const decodeStatus = useRef<number>(0)
  const lastVideoTimeStamp = useRef<number>(0)
  const lastAudioTimeStamp = useRef<number>(0)
  const currentPlayTimestamp = useRef(0)
  const preRafTimestamp = useRef(0)
  const preTime = useRef(0)
  const currRafTimestamp = useRef(0)
  const nextPlayTimestamp = useRef(0)
  const playOffset = 3
  const [rate, setRate] = useState(0)
  const rafAvgTimeInterval = useRef(0)
  const playStatus = useRef<string>('not_begin')

  const onChange = (e: FormEvent) => {
    const file = (e.target as HTMLInputElement).files![0]
    init(file)
    // decoder.initHandler({ file, startTime: 0 })
  }

  const handlePlay = (timestamp = 0) => {
    let i = 0
    playTimer.current = setInterval(() => {
      console.log('获取一帧', new Date().getTime())
      worker.current.value.worker.postMessage({ type: ACTION_TYPE_PLAY, payload: i * 40 })
      i++
      if (i * 40 > 33 * 1000) {
        clearInterval(playTimer.current)
      }
    }, 40)
  }

  const getFrame = (timestamp: number) => {
    return new Promise((resolve) => {
      console.log('提取一帧', new Date().getTime())
      worker.current.value.worker.postMessage({ type: ACTION_TYPE_PLAY, payload: timestamp })
      workerPlayCb.current = (payload: any) => {
        resolve(payload)
      }
    })
  }

  const play = async (timestamp = 0) => {
    const frame = framePool.current.shift()
    if (frame) {
      drawYUV(frame)
    }

    if (framePool.current.length <= 12) {
      if (decodeStatus.current !== DECODE_STATUS_FINISH) {
        worker.current.value.worker.postMessage({ type: ACTION_TYPE_DECODE, payload: { count: 24 - framePool.current.length, videoStartTime: lastVideoTimeStamp.current, audioStartTime: lastVideoTimeStamp.current } })
      }
    }
  }

  const playAudioFrame = () => {
    const audioFrame = decodeAudioFramePool.current.shift()
    if (!audioFrame) {
      console.log('当前没有音频帧')
      playStatus.current = 'stop'
      return
    }

    const { data, dataSize, playTimestamp, sample_rate, channel: channels } = audioFrame

    const buffer = audioFrame.data;

    const audioBuffer = audioContext.createBuffer(channels, buffer.length / channels, sample_rate);

    for (let channel = 0; channel < channels; channel++) {
      let nowBuffering = audioBuffer.getChannelData(channel);
      for (var i = 0; i < buffer.length / channels; i++) {
        nowBuffering[i] = buffer[i * channels + channel];
      }
    }

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start(0);

    source.onended = () => {
      console.log('结束')
    };
  }

  const saveAudioBuffer = (audioFrame: Record<string, any>) => {
    decodeAudioFramePool.current.push(audioFrame)
    playAudioFrame()
  }

  const handleDecode = (timestamp = 0, count = 48) => {
    worker.current.value.worker.postMessage({ type: ACTION_TYPE_DECODE, payload: { count, videoStartTime: timestamp, audioStartTime: timestamp } })
  }

  const handleGetPlayFrame = (timestamp = 0) => {
    console.time("获取一帧时间")
    worker.current.value.worker.postMessage({ type: ACTION_TYPE_GET_FRAME, payload: timestamp })
  }

  const onReceiveFrame = (frameDetail: any) => {
    console.log(frameDetail)
    console.timeEnd("获取一帧时间")
    decodeFramePool.current = frameDetail
    decodeFramePool.current.sort((a: any, b: any) => a.playTimestamp - b.playTimestamp)
    playFrame()
  }

  const onFinishDecode = ({ count }: { count: number }) => {
    console.log('解码数量: ', count)
    handleGetPlayFrame(0)
  }

  const playFrame = () => {
    let count = 0
    let rafCount = 0
    drawYUV(decodeFramePool.current[0])
    const play = () => {
      requestAnimationFrame(() => {
        console.time("整体逻辑耗时")
        console.time("前置运算")
        const currentTime = new Date().getTime()
        if (!preTime.current) {
          preTime.current = currentTime
        }
        currRafTimestamp.current = currentTime - preTime.current
        console.log('当前currRafTimestamp', currRafTimestamp.current)
        rafCount && (rafAvgTimeInterval.current = currRafTimestamp.current / rafCount)
        console.log('raf平局时间间隔', rafAvgTimeInterval.current)

        const lastFrame = decodeFramePool.current.slice(-1)[0]
        if (!lastFrame || currRafTimestamp.current > lastFrame.playTimestamp) {
          return
        }
        console.timeEnd("前置运算")
        console.time("遍历耗时")
        const frameIndex = decodeFramePool.current.findIndex(item => item.playTimestamp >= currRafTimestamp.current && item.playTimestamp <= currRafTimestamp.current + rafAvgTimeInterval.current)
        console.timeEnd("遍历耗时")
        if (frameIndex > -1) {
          const frame = decodeFramePool.current[frameIndex]
          console.log('当前playtimestamp', frame.playTimestamp)
          console.time("绘制耗时")
          drawYUV(frame)
          console.timeEnd("绘制耗时")
          console.time("处理数组耗时")
          decodeFramePool.current = decodeFramePool.current.slice(frameIndex + 1)
          count++
          currRafTimestamp.current && setRate(Math.round(1000 * count / currRafTimestamp.current))
          console.timeEnd("处理数组耗时")
        }

        rafCount++

        console.timeEnd("整体逻辑耗时")

        play()
      })
    }
    play()
  }

  const onMessage = useCallback((e: { data: { type: string, payload: any } }) => {
    const { data: { type, payload } } = e
    switch (type) {
      case ACTION_TYPE_INIT:
        console.log('初始化解码器成功----')
        handleDecode()
        // handlePlay(0)
        setTimeout(() => {
          // play()
          // playAudioFrame()
        }, 1000)

        break
      case ACTION_TYPE_DECODE:
        console.log('解码ACTION_TYPE_DECODE')
        break
      case ACTION_TYPE_PLAY:
        workerPlayCb.current && workerPlayCb.current(payload)
        // drawYUV(payload)
        break
      case ACTION_TYPE_FLUSH:
        console.log('释放内存')
        break
      case 'test':
        console.log('接受主动推送---->', new Date().getTime())
        break
      case ACTION_TYPE_DECODE_FRAME:
        decodeFramePool.current.push(payload)
        const { end } = payload
        if (end) {
          decodeFramePool.current.sort((a: any, b: any) => a.playTimestamp - b.playTimestamp)
          framePool.current.push(...decodeFramePool.current)
          const lastFrame = framePool.current.slice(-1)[0]
          lastFrame && (lastVideoTimeStamp.current = lastFrame.playTimestamp)
          decodeFramePool.current = []
        }
        break
      case ACTION_TYPE_STATUS_CHANGE:
        decodeStatus.current = payload
        break
      case ACTION_TYPE_DECODE_AUDIO_FRAME:
        saveAudioBuffer(payload)
        break
      case ACTION_TYPE_FINISH_DECODE:
        onFinishDecode(payload)
        break
      case ACTION_TYPE_POST_FRAME:
        onReceiveFrame(payload)
        break
    }
  }, [])

  const init = useCallback((file: any) => {
    worker.current.value.worker.postMessage({ type: ACTION_TYPE_INIT, payload: { file, startTime: 0 } })
  }, [])

  const initYUVCanvas = () => {
    const _yuv = YUVCanvas.attach(canvas.current);
    yuv.current.value = _yuv
  }

  const drawYUV = (frameDetail: any) => {
    console.log('渲染一帧--------------------------------------->', new Date().getTime())
    console.log(frameDetail.playTimestamp)
    yuv.current.value.clear()
    yuv.current.value.drawFrame(frameDetail)
    frameDetail = null
  }

  const onAacChange = async (event: FormEvent<HTMLInputElement>) => {
    const inputElement = event.target as HTMLInputElement;
    const files = inputElement.files;

    // 创建AudioContext实例
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    if (files && files.length > 0) {
      const file = files[0];
      const arrayBuffer = await file.arrayBuffer();

      // 在这里调用解码函数
      const buffer = await decodeAAC(audioContext, arrayBuffer);

      console.log(buffer.getChannelData(0).map(val => val * 10000000000))
      console.log(buffer.getChannelData(1).map(val => val * 10000000000))

      // 在这里使用解码后的AudioBuffer
      console.log('AudioBuffer:', buffer);
    }
  }

  // 定义解码函数
  async function decodeAAC(audioContext: AudioContext, arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    // 创建AudioContext实例
    return new Promise((resolve, reject) => {
      audioContext.decodeAudioData(arrayBuffer, (buffer) => {
        resolve(buffer);
      }, (error) => {
        reject(error);
      });
    });
  }

  useLayoutEffect(() => {
    initYUVCanvas()
    // decoder.init()
  }, [])

  useEffect(() => {
    const _worker = initWorker()
    worker.current.value = _worker
    _worker.worker.onmessage = onMessage
  }, [onMessage])

  return (
    <div className="player-wrapper">
      <input id="file" type="file" onChange={onChange} placeholder='选择文件' />
      <input id="file" type="file" onChange={onAacChange} placeholder='选择aac文件' />
      <div>{rate}</div>
      <div className="canvas-wrapper">
        <canvas className="canvas" ref={canvas} />
      </div>
    </div>
  )
}

export default Player
