let worker: InstanceType<typeof Worker> | null = null

export const initWorker = () => {
  if (!worker) {
    worker = new Worker('/static/decoder/worker.js')
  }
  
  return {
    worker,
    destroy: () => (worker as InstanceType<typeof Worker>).terminate()
  }
}

export type IWorker = typeof initWorker extends (...args: any) => infer R ? R : any
