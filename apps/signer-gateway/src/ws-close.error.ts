export class WsCloseError extends Error {
  constructor(
    public readonly closeCode: number,
    message: string,
  ) {
    super(message);
  }
}
