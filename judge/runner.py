import json
import os
import signal
import subprocess

cases = json.load(open('/input/tests.json'))
env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/work', 'TMPDIR': '/work'}

def stop_group(process):
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass

try:
    build = subprocess.run(
        ['gcc', '-std=c11', '-O0', '-w', '/input/source.c', '-o', '/work/program'],
        capture_output=True, timeout=10, env=env,
    )
    if build.returncode:
        print(json.dumps({'compiled': False, 'results': [{'passed': False} for _ in cases],
                          'error': build.stderr.decode(errors='replace')[:4000]}))
    else:
        results = []
        for case in cases:
            with open('/work/output', 'w+b') as out, open('/work/error', 'w+b') as err:
                process = subprocess.Popen(
                    ['/work/program'], stdin=subprocess.PIPE, stdout=out,
                    stderr=err, env=env, start_new_session=True,
                )
                try:
                    process.communicate(input=case['input'].encode(), timeout=2)
                    out.seek(0)
                    results.append({'output': out.read(8193).decode(errors='replace'),
                                    'code': process.returncode})
                except subprocess.TimeoutExpired:
                    results.append({'passed': False, 'error': 'Time limit exceeded'})
                finally:
                    # Also remove background children after a main process exits.
                    stop_group(process)
                    process.wait()
        print(json.dumps({'compiled': True, 'results': results}))
except subprocess.TimeoutExpired:
    print(json.dumps({'compiled': False, 'results': [{'passed': False} for _ in cases],
                      'error': 'Compilation timeout'}))
