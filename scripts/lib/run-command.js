import { spawn } from 'node:child_process'

function executableFor(command) {
  if (command === 'wrangler') return process.platform === 'win32' ? 'npx.cmd' : 'npx'
  if (command === 'npm' && process.platform === 'win32') return 'npm.cmd'
  return command
}

export function runCommand(command, args, options = {}) {
  const finalArgs = command === 'wrangler' ? ['wrangler', ...args] : args
  return new Promise((resolve, reject) => {
    const mirrorOutput = options.stdio === 'inherit'
    // When mirrorOutput is requested we want to both mirror stdin and capture
    // stdout/stderr. Using a stdio array with shell:true is safe on Windows,
    // and allows us to capture stderr for error messages while still
    // inheriting stdin.
    const stdio = mirrorOutput
      ? ['inherit', 'pipe', 'pipe']
      : options.stdio

    let child
    try {
      if (process.platform === 'win32') {
        const exec = executableFor(command)
        const isCmdish = exec.toLowerCase().endsWith('.cmd') || exec.toLowerCase().endsWith('.bat')
        if (isCmdish) {
          // For .cmd/.bat wrappers, run via shell with a single command string.
          let quotedExec = exec
          if (quotedExec === process.execPath || quotedExec.includes(' ')) quotedExec = `"${quotedExec}"`
          const cmd = [quotedExec, ...finalArgs].join(' ')
          child = spawn(cmd, { ...options, stdio, shell: true })
        } else {
          // For native executables (like node.exe), spawn directly with args array.
          // Normalize Windows absolute paths that come from URL.pathname which start
          // with a leading slash like '/D:/path' — remove the leading slash so Node
          // resolves the path correctly.
          const argsToUse = finalArgs.map((a) => {
            if (typeof a === 'string' && a.length > 2 && a[0] === '/' && /^[A-Za-z]:/.test(a.slice(1, 3))) {
              return a.slice(1)
            }
            return a
          })
          child = spawn(exec, argsToUse, { ...options, stdio, shell: false })
        }
      } else {
        child = spawn(executableFor(command), finalArgs, { ...options, stdio, shell: false })
      }
    } catch (error) {
      return Promise.reject(error)
    }
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
      if (mirrorOutput) process.stdout.write(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
      if (mirrorOutput) process.stderr.write(chunk)
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve(stdout)
      else {
        const details = [stderr, stdout].map((value) => value.trim()).filter(Boolean).join('\n')
        reject(new Error(`${command} ${args.join(' ')} 执行失败（退出码 ${code}）。${details ? `\n${details}` : ''}`))
      }
    })
  })
}
