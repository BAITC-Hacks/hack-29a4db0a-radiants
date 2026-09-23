/** A response must still own both the generation and the profile it started for. */
export class LatestRequest {
  private generation = 0;
  private controller?: AbortController;
  cancel() {
    this.generation += 1;
    this.controller?.abort();
  }
  start(employeeId: string, profileRevision: number) {
    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    return {
      signal: controller.signal,
      accepts: (currentEmployeeId: string, currentRevision: number) =>
        generation === this.generation && !controller.signal.aborted &&
        employeeId === currentEmployeeId && profileRevision === currentRevision,
    };
  }
}
