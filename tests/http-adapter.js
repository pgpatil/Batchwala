// Test-only storage adapter: talks to tests/fake_drive.py. Enabled with localStorage "bw.testAdapter" = server URL.
export function createHttpAdapter(base) {
  return {
    id: "http", account: "tester@example.com",
    ready: async () => {},
    listFiles: async () => (await fetch(base + "/fs/list")).json(),
    readFile: async id => (await fetch(base + "/fs/file/" + encodeURIComponent(id))).text(),
    writeFile: async (name, text) => { await fetch(base + "/fs/file/" + encodeURIComponent(name), { method: "PUT", body: text }); return name; },
    writeBinary: async () => "x", shareWith: async () => {}, folderLink: () => ""
  };
}
