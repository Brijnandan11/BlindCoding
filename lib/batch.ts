// Groups independent remote operations without acknowledging them before commit.
export class BatchQueue<Input, Output> {
  private pending: {
    input: Input;
    resolve: (value: Output) => void;
    reject: (error: unknown) => void;
  }[] = [];
  private active = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly execute: (items: Input[]) => Promise<Output[]>,
    private readonly size = 50,
    private readonly delay = 25,
    private readonly concurrency = 4,
  ) {}
  add(input: Input): Promise<Output> {
    if (this.pending.length >= 10000)
      return Promise.reject(new Error("Service unavailable. Database backlog is full."));
    return new Promise((resolve, reject) => {
      this.pending.push({ input, resolve, reject });
      if (this.pending.length >= this.size) this.drain();
      else this.schedule();
    });
  }
  private schedule() {
    if (!this.timer && this.pending.length)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.drain();
      }, this.delay);
  }
  private drain() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    while (this.active < this.concurrency && this.pending.length) {
      const batch = this.pending.splice(0, this.size);
      this.active++;
      Promise.resolve()
        .then(() => this.execute(batch.map((item) => item.input)))
        .then((values) => {
          if (values.length !== batch.length) throw new Error("Invalid database batch response.");
          batch.forEach((item, index) => item.resolve(values[index]));
        })
        .catch((error) => batch.forEach((item) => item.reject(error)))
        .finally(() => {
          this.active--;
          this.schedule();
        });
    }
  }
}
