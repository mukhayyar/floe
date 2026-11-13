//! Keeps Floe's proxy running on Linux and Windows (launchd does it on macOS).
//!
//! Every few seconds: if `/health` answers, someone already runs it (launchd, systemd, a dev
//! shell) and we leave it alone. If not, start `bun <install>/proxy/src/server.ts`, logging to
//! `<logs>/proxy.log`, and restart it with backoff when it exits. Only a proxy we started is
//! stopped when Floe quits. (On macOS only with FLOE_SUPERVISE=1, for testing.)

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::paths;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProxyState {
    /// running | external | starting | no-bun | no-proxy | crashed | offline (macOS)
    pub state: String,
    pub message: String,
    pub port: u16,
    pub install_dir: String,
    pub logs_dir: String,
    /// Whether this app started (and owns) the proxy process.
    pub owned: bool,
}

#[derive(Default)]
pub struct Supervisor {
    pub state: Mutex<Option<ProxyState>>,
    child: Mutex<Option<Child>>,
}

impl Supervisor {
    pub fn snapshot(&self) -> Option<ProxyState> {
        self.state.lock().ok()?.clone()
    }

    /// Stop the proxy, but only if we started it.
    pub fn shutdown(&self) {
        if let Ok(mut c) = self.child.lock() {
            if let Some(mut child) = c.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

pub fn health(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(800)) else { return false };
    let _ = s.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = s.set_write_timeout(Some(Duration::from_millis(800)));
    let req = format!("GET /health HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if s.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 64];
    let n = s.read(&mut buf).unwrap_or(0);
    let head = String::from_utf8_lossy(&buf[..n]);
    head.starts_with("HTTP/1.") && head.split_whitespace().nth(1) == Some("200")
}

fn server_script() -> PathBuf {
    paths::install_dir().join("proxy").join("src").join("server.ts")
}

fn spawn(bun: &PathBuf, script: &PathBuf) -> std::io::Result<Child> {
    let logs = paths::logs_dir();
    fs::create_dir_all(&logs)?;
    let log = OpenOptions::new().create(true).append(true).open(logs.join("proxy.log"))?;
    let err = log.try_clone()?;
    let mut cmd = Command::new(bun);
    cmd.arg(script)
        .current_dir(script.parent().and_then(|p| p.parent()).unwrap_or(script))
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(err));
    // A dev build's UI comes from Vite on localhost:1420; only then may that origin drive the proxy.
    if cfg!(debug_assertions) {
        cmd.env("FLOE_DEV", "1");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    // The proxy we start lives and dies with us, even if Floe is killed rather than quit, so an
    // update or a crash never leaves a second proxy holding the port.
    #[cfg(target_os = "linux")]
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| {
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
            Ok(())
        });
    }
    let child = cmd.spawn()?;
    #[cfg(windows)]
    tie_to_us(&child);
    Ok(child)
}

/// Windows: a job object that kills its processes when Floe's handle to it closes (Floe exits).
#[cfg(windows)]
fn tie_to_us(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;
    use windows_sys::Win32::System::JobObjects::*;
    static JOB: OnceLock<isize> = OnceLock::new();
    let job = *JOB.get_or_init(|| unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return 0;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        job as isize
    });
    if job != 0 {
        unsafe {
            AssignProcessToJobObject(job as _, child.as_raw_handle() as _);
        }
    }
}

pub fn start(app: AppHandle, sup: Arc<Supervisor>, port: u16) {
    thread::spawn(move || {
        let mut backoff = Duration::from_secs(1);
        let mut started_at: Option<Instant> = None;
        loop {
            let install = paths::install_dir().display().to_string();
            let logs = paths::logs_dir().display().to_string();
            let mut owned = false;
            let mut exited: Option<String> = None;
            if let Ok(mut c) = sup.child.lock() {
                if let Some(child) = c.as_mut() {
                    match child.try_wait() {
                        Ok(None) => owned = true,
                        Ok(Some(status)) => {
                            exited = Some(format!("Floe's proxy stopped ({status}); restarting"));
                            *c = None;
                        }
                        Err(e) => {
                            exited = Some(format!("Lost track of Floe's proxy ({e})"));
                            *c = None;
                        }
                    }
                }
            }
            let up = health(port);
            let next = if up {
                backoff = Duration::from_secs(1);
                started_at = None;
                ProxyState {
                    state: if owned { "running" } else { "external" }.into(),
                    message: if owned { "Floe started its proxy" } else { "Floe's proxy is running" }.into(),
                    port,
                    install_dir: install,
                    logs_dir: logs,
                    owned,
                }
            } else if owned {
                // Booting: give it a while before calling it stuck.
                let waited = started_at.map(|t| t.elapsed()).unwrap_or_default();
                if waited > Duration::from_secs(40) {
                    sup.shutdown();
                    started_at = None;
                }
                ProxyState { state: "starting".into(), message: "Starting Floe's proxy…".into(), port, install_dir: install, logs_dir: logs, owned }
            } else if cfg!(target_os = "macos") && std::env::var_os("FLOE_SUPERVISE").is_none() {
                // launchd owns the proxy on macOS (com.mukhayyar.floe.proxy); never race it.
                ProxyState {
                    state: "offline".into(),
                    message: "Floe's proxy isn't answering. On macOS launchd runs it: launchctl kickstart -k gui/$UID/com.mukhayyar.floe.proxy".into(),
                    port,
                    install_dir: install,
                    logs_dir: logs,
                    owned: false,
                }
            } else {
                let script = server_script();
                match (script.is_file(), paths::bun()) {
                    (false, _) => ProxyState {
                        state: "no-proxy".into(),
                        message: format!("Floe's proxy isn't installed (looked for {}). Run the Floe installer.", script.display()),
                        port,
                        install_dir: install,
                        logs_dir: logs,
                        owned: false,
                    },
                    (true, None) => ProxyState {
                        state: "no-bun".into(),
                        message: "Bun isn't installed. Floe's proxy runs on Bun: install it from bun.sh, then reopen Floe.".into(),
                        port,
                        install_dir: install,
                        logs_dir: logs,
                        owned: false,
                    },
                    (true, Some(bun)) => {
                        if let Some(why) = &exited {
                            crate::log::line(&format!("{why}; waiting {}s", backoff.as_secs()));
                            thread::sleep(backoff);
                            backoff = (backoff * 2).min(Duration::from_secs(30));
                        }
                        match spawn(&bun, &script) {
                            Ok(child) => {
                                crate::log::line(&format!("started the proxy (pid {}) with {}", child.id(), bun.display()));
                                if let Ok(mut c) = sup.child.lock() {
                                    *c = Some(child);
                                }
                                started_at = Some(Instant::now());
                                ProxyState { state: "starting".into(), message: "Starting Floe's proxy…".into(), port, install_dir: install, logs_dir: logs, owned: true }
                            }
                            Err(e) => ProxyState {
                                state: "crashed".into(),
                                message: format!("Couldn't start Floe's proxy: {e}"),
                                port,
                                install_dir: install,
                                logs_dir: logs,
                                owned: false,
                            },
                        }
                    }
                }
            };
            let changed = sup.state.lock().map(|mut s| {
                let changed = s.as_ref() != Some(&next);
                *s = Some(next.clone());
                changed
            });
            if changed.unwrap_or(false) {
                let _ = app.emit("proxy", next.clone());
            }
            let wait = match next.state.as_str() {
                "running" | "external" => 5,
                "starting" => 1,
                _ => 8,
            };
            thread::sleep(Duration::from_secs(wait));
        }
    });
}
