const { PythonShell } = require("python-shell");
const path = require("path");

class PythonBridge {
  constructor() {
    this.scriptDir = path.join(__dirname);
  }

  _run(scriptName, args = {}) {
    return new Promise((resolve, reject) => {
      const options = {
        mode: "json",
        pythonOptions: ["-u"],
        scriptPath: this.scriptDir,
        args: [JSON.stringify(args)],
      };

      PythonShell.run(scriptName, options)
        .then((results) => {
          if (results && results.length > 0) {
            const last = results[results.length - 1];
            if (last.error) {
              reject(new Error(last.error));
            } else {
              resolve(last);
            }
          } else {
            resolve(null);
          }
        })
        .catch((err) => reject(err));
    });
  }

  async runSimulation(config) {
    return this._run("run_simulation.py", config);
  }

  async runRcsSimulation(config) {
    return this._run("run_rcs.py", config);
  }

  async checkPython() {
    return this._run("check_env.py");
  }

  kill() {
    // PythonShell.run creates one-shot processes, no persistent shell to kill
  }
}

module.exports = { PythonBridge };
