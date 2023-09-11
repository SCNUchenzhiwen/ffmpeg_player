import React, { FormEvent, useEffect, useRef, useLayoutEffect, useCallback } from 'react'
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

const DECODE_STATUS_NOT_BEGIN = 0
const DECODE_STATUS_DECODING = 1
const DECODE_STATUS_PAUSE = 2
const DECODE_STATUS_FINISH = 3

const Player = () => {
  const worker = useRef<{ value: IWorker }>({ value: {} as IWorker })
  const canvas = useRef<HTMLCanvasElement>(null)
  const yuv = useRef<{ value: Record<string, any> }>({ value: {} })
  const playTimer = useRef<any>(null)
  const workerPlayCb = useRef<any>(null)
  const decodeFramePool = useRef<any>([])
  const framePool = useRef<any>([])
  const decodeStatus = useRef<number>(0)

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
      if (i * 40 >  33 * 1000) {
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
    // let beginTimestamp = 0
    // const interval = 40
    // let count = 0
    // let currentTimestamp = beginTimestamp
    // const frame = await getFrame(timestamp)
    // drawYUV(frame)
    const frame = framePool.current.shift()
    if (frame) {
      drawYUV(frame)
    }
    
    if (framePool.current.length <= 12) {
      if (decodeStatus.current !== DECODE_STATUS_FINISH) {
        worker.current.value.worker.postMessage({ type: ACTION_TYPE_DECODE, payload: 24 - framePool.current.length })
      }
    }

    setTimeout(() => {
      if (decodeStatus.current === DECODE_STATUS_FINISH && !frame) {
        worker.current.value.worker.postMessage({ type: ACTION_TYPE_FLUSH, payload: 24 - framePool.current.length })
        framePool.current = []
        decodeFramePool.current = []
        return
      }
      play(timestamp + 40)
    }, 40)
  }

  const onMessage = useCallback((e: { data: { type: string, payload: any } }) => {
    const { data: { type, payload } } = e
    switch(type) {
      case ACTION_TYPE_INIT:
        console.log('初始化解码器成功----')
        // handlePlay(0)
        setTimeout(() => {
          play()
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
          decodeFramePool.current = []
        }
        break
      case ACTION_TYPE_STATUS_CHANGE:
        decodeStatus.current = payload
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
      yuv.current.value.clear()
      yuv.current.value.drawFrame(frameDetail)
      frameDetail = null
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
      <div className="canvas-wrapper">
        <canvas className="canvas" ref={canvas} />
      </div>
    </div>
  )
}

export default Player
