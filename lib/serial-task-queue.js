class SerialTaskQueue {
  constructor() {
    this.tail = Promise.resolve();
  }

  enqueue(task) {
    const run = this.tail.then(() => task());
    this.tail = run.catch(() => {});
    return run;
  }
}

module.exports = {
  SerialTaskQueue
};
