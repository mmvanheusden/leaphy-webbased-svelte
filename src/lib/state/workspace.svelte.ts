import {writable} from "svelte/store";
import type {RobotDevice} from "$domain/robots";
import Blocks from "$components/workspace/blocks/Blocks.svelte";
import Advanced from "$components/workspace/advanced/Advanced.svelte";
import type {ComponentType} from "svelte";

export const Mode = {
    BLOCKS: Blocks,
    ADVANCED: Advanced
}

export enum Prompt {
  NEVER,
  MAYBE,
  ALWAYS
}

export class ConnectionFailedError {}

interface LogItem {
  id: string,
  date: Date,
  content: string
}

export const SUPPORTED_VENDOR_IDS = [0x1a86, 9025, 2341, 0x0403, 0x2e8a]

let writer: WritableStreamDefaultWriter<Uint8Array>
function createLogState() {
  const { subscribe, update } = writable<LogItem[]>([])
  let buffer = ''

  return {
    subscribe,
    write(content: string) {
      writer.write(new TextEncoder().encode(content))
    },
    enqueue(content: Uint8Array) {
      buffer += new TextDecoder().decode(content)

      const items = buffer.split('\n')
      buffer = items.pop()

      if (items.length > 0) {
        update(log => ([...log, ...items.map(content => ({
          id: crypto.randomUUID(),
          date: new Date(),
          content
        }))].slice(-100)))
      }
    }
  }
}
export const log = createLogState()

function createPortState() {
  const { subscribe, update } = writable<SerialPort>()

  let reserved: boolean = false
  let reader: ReadableStreamDefaultReader<Uint8Array>
  subscribe(async port => {
    if (!port || reserved) return
    if (!port.readable || !port.writable) {
      await port.open({ baudRate: 115200 })
    }
    if (port.readable.locked || port.writable.locked) return

    writer = port.writable.getWriter()
    reader = port.readable.getReader()
    while (port.readable && port.writable) {
      const { done, value } = await reader.read()
      if (done) break

      log.enqueue(value)
    }
  })

  return {
    subscribe,
    async connect(prompt: Prompt) {
      if (prompt !== Prompt.ALWAYS) {
        const [port] = await navigator.serial.getPorts()
        if (port) {
          update(() => port)
          return port
        }
      }
      if (prompt === Prompt.NEVER) throw new ConnectionFailedError();

      const port = await navigator.serial.requestPort({ 
        filters: SUPPORTED_VENDOR_IDS.map((vendor) => ({
          usbVendorId: vendor,
        }))
      })
      update(() => port)
      return port
    },
    reserve() {
      reserved = true

      reader.cancel()
      reader.releaseLock()

      writer.releaseLock()
    },
    release() {
      reserved = false
      update(port => port)
    }
  }
}
export const port = createPortState()

function createUploadLog() {
  const { subscribe, update, set } = writable<string[]>([])
  
  return {
    subscribe,
    set,
    add(item: string) {
      update(log => [...log, item])
    },
    clear() {
      update(() => [])
    }
  }
}
export const uploadLog = createUploadLog()

export const sidePanel = writable<ComponentType|undefined>(undefined)

export const handle = writable<FileSystemFileHandle|undefined>(undefined)

class WorkspaceState {
  robot = $state<RobotDevice>()
  mode = $state<ComponentType>(Mode.BLOCKS)
  code = $state<string>("")
}
export default new WorkspaceState()
