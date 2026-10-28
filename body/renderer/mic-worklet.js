// Microphone capture: hands each 128-sample block of the first channel to the
// page, which runs the speech detection (mic.ts).
class HerCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) this.port.postMessage(channel.slice(0))
    return true
  }
}

registerProcessor('her-capture', HerCapture)
