import { exec } from 'child_process';

const NVIDIA_SMI_CMD =
  'nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw --format=csv,noheader,nounits';

export class GPUMonitor {
  constructor(win, intervalMs = 2000) {
    this.win = win;
    this.intervalMs = intervalMs;
    this.timer = null;
  }

  start() {
    this._poll();
    this.timer = setInterval(() => this._poll(), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  _poll() {
    exec(NVIDIA_SMI_CMD, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) {
        // nvidia-smi not available or failed — send error status
        this._send({ error: err.message });
        return;
      }

      // Multi-GPU: nvidia-smi may output multiple lines; take only the first
      const firstLine = stdout.trim().split('\n')[0];
      // Split on ', ' (comma+space) to avoid breaking GPU names that contain commas
      const parts = firstLine.split(', ');
      if (parts.length < 7) {
        this._send({ error: 'Unexpected nvidia-smi output', raw: stdout });
        return;
      }

      this._send({
        name: parts[0],
        temperature: parseFloat(parts[1]),
        gpuUtilization: parseFloat(parts[2]),
        memoryUtilization: parseFloat(parts[3]),
        memoryUsed: parseFloat(parts[4]),
        memoryTotal: parseFloat(parts[5]),
        powerDraw: parseFloat(parts[6]),
      });
    });
  }

  _send(data) {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('gpu-data', data);
    }
  }
}
