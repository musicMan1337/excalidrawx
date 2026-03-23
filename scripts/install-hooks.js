var fs = require("fs");
var path = require("path");
var execSync = require("child_process").execSync;

var MANAGED_MARKER = "# [managed by install-hooks]";

function installHook(hookName, scriptPath) {
  var gitDir = execSync("git rev-parse --git-dir", { encoding: "utf8" }).trim();
  var hooksDir = path.join(gitDir, "hooks");
  var hookFile = path.join(hooksDir, hookName);
  var line = 'bash "$(git rev-parse --show-toplevel)/' + scriptPath + '"';
  var markedLine = line + "  " + MANAGED_MARKER;

  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  if (fs.existsSync(hookFile)) {
    var contents = fs.readFileSync(hookFile, "utf8");
    if (contents.indexOf(MANAGED_MARKER) !== -1) {
      return false;
    }
    fs.appendFileSync(hookFile, "\n" + markedLine + "\n");
  } else {
    fs.writeFileSync(hookFile, "#!/bin/bash\n" + markedLine + "\n", {
      mode: 0o755,
    });
  }

  return true;
}

var firstTime = installHook("post-checkout", "scripts/setup-agent-symlinks.sh");

if (firstTime) {
  try {
    execSync("bash scripts/setup-agent-symlinks.sh", { stdio: "inherit" });
  } catch (err) {
    // Symlink setup is non-critical
  }
}
