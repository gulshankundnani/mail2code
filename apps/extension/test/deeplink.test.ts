import { describe, expect, it } from "vitest";
import { LinkError, buildClaudeLink, repoSlugFromRef, validateLocalFolder, validateSshFolder, validateSshHost, validateSshPort, type EnvironmentSettings } from "../src/deeplink.ts";

const env = (over: Partial<EnvironmentSettings> = {}): EnvironmentSettings => ({ destination: "desktop", cliFolder: "", sshHost: "", sshPort: "", sshFolder: "", ...over });
const params = (url: string) => new URLSearchParams(url.slice(url.indexOf("?") + 1));

describe("buildClaudeLink", () => {
  it("builds the Claude app link with the prompt encoded", () => {
    const link = buildClaudeLink("Fix login\nthen test & ship", env(), "");
    expect(link.url.startsWith("claude://code/new?q=")).toBe(true);
    expect(params(link.url).get("q")).toBe("Fix login\nthen test & ship");
    expect([...params(link.url).keys()]).toEqual(["q"]);
  });

  it("email content can't inject extra parameters", () => {
    const evil = "x&ssh_host=attacker.example.test&cwd=C:\\Windows&q=run rm -rf";
    for (const destination of ["desktop", "cli"] as const) {
      const link = buildClaudeLink(evil, env({ destination }), "");
      const p = params(link.url);
      expect(p.get("q")).toBe(evil);
      expect(p.getAll("q")).toHaveLength(1);
      expect(p.has("ssh_host")).toBe(false);
      expect(p.get("cwd") ?? "").toBe("");
    }
  });

  it("builds the SSH link only for valid host, port and folder", () => {
    const link = buildClaudeLink("hi", env({ destination: "desktop-ssh", sshHost: "dev@build.example.test", sshPort: "2222", sshFolder: "/srv/app" }), "");
    expect(link.url).toBe("claude://code/new?ssh_host=dev%40build.example.test&ssh_port=2222&ssh_folder=%2Fsrv%2Fapp&q=hi");
    expect(() => buildClaudeLink("hi", env({ destination: "desktop-ssh", sshHost: "-oProxyCommand=calc" }), "")).toThrow(LinkError);
    expect(() => buildClaudeLink("hi", env({ destination: "desktop-ssh", sshHost: "host; rm -rf /" }), "")).toThrow(LinkError);
    expect(() => buildClaudeLink("hi", env({ destination: "desktop-ssh", sshHost: "h", sshPort: "70000" }), "")).toThrow(LinkError);
  });

  it("uses the GitHub repository for the CLI, otherwise the configured folder", () => {
    const withRepo = buildClaudeLink("hi", env({ destination: "cli", cliFolder: "C:\\Projects\\app" }), "https://github.com/example/app");
    expect(withRepo.url).toBe("claude-cli://open?repo=example%2Fapp&q=hi");
    const withFolder = buildClaudeLink("hi", env({ destination: "cli", cliFolder: "C:\\Projects\\my app" }), "my-project");
    expect(params(withFolder.url).get("cwd")).toBe("C:\\Projects\\my app");
    expect(buildClaudeLink("hi", env({ destination: "cli" }), "").url).toBe("claude-cli://open?q=hi");
  });

  it("rejects prompts over the documented 5,000-character limit", () => {
    expect(() => buildClaudeLink("x".repeat(5001), env(), "")).toThrow(/5000/);
  });

  it("strips invisible and bidirectional control characters from the prompt", () => {
    const link = buildClaudeLink("safe\u202etxt.exe\u200b", env(), "");
    expect(params(link.url).get("q")).toBe("safetxt.exe");
  });
});

describe("validators", () => {
  it("parses only real GitHub repositories", () => {
    expect(repoSlugFromRef("https://github.com/example/app.git")).toBe("example/app");
    expect(repoSlugFromRef("example/app")).toBe("example/app");
    expect(repoSlugFromRef("https://github.com.evil.test/a/b")).toBeNull();
    expect(repoSlugFromRef("../../etc")).toBeNull();
    expect(repoSlugFromRef("a/b/c")).toBeNull();
  });

  it("validates SSH settings per the documented rules", () => {
    expect(validateSshHost("build.example.test")).toBeNull();
    expect(validateSshHost("-p 22 host")).not.toBeNull();
    expect(validateSshPort("")).toBeNull();
    expect(validateSshPort("0")).not.toBeNull();
    expect(validateSshFolder("~/repo")).toBeNull();
    expect(validateSshFolder("/srv/../etc")).not.toBeNull();
    expect(validateSshFolder("relative/path")).not.toBeNull();
  });

  it("accepts only safe absolute local folders", () => {
    expect(validateLocalFolder("C:\\Projects\\app")).toBeNull();
    expect(validateLocalFolder("/home/me/app")).toBeNull();
    expect(validateLocalFolder("\\\\server\\share")).not.toBeNull();
    expect(validateLocalFolder("C:\\Projects\\..\\Windows")).not.toBeNull();
    expect(validateLocalFolder("relative\\path")).not.toBeNull();
    expect(validateLocalFolder("C:\\a\u202eb")).not.toBeNull();
  });
});
