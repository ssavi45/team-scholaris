declare namespace Deno {
  namespace env { function get(name: string): string | undefined }
  function serve(handler: (request: Request) => Response | Promise<Response>): void
}
