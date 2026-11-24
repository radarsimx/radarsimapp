// ===== RadarSimApp - About and License =====
// The About dialog (versions and the license in use) and the license dialog,
// which opens by itself at startup while the library is unlicensed.

import { byId } from "./utils.js";

// Fields from radarsimc's Get_License_Info, in display order, with our labels.
// "License Status" and "Current Platform" are left out: the status line above
// already says the first, and the second is just this machine.
const LICENSE_FIELDS: [key: string, label: string][] = [
  ["Licensed to", "Licensed to"],
  ["Organization", "Organization"],
  ["Email", "Email"],
  ["Product", "Product"],
  ["License Type", "Type"],
  ["License Platform", "Platform"],
];

function _showDialog(id: string, show: boolean): void {
  byId(id).classList.toggle("hidden", !show);
}

function _setLicenseDetailsExpanded(expanded: boolean): void {
  const toggle = byId("btn-license-details");
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.textContent = expanded ? "Hide details" : "Show details";
  byId("about-license-details").classList.toggle("hidden", !expanded);
}

function _renderLicenseStatus(licensed: boolean, info: Record<string, string> = {}): void {
  const licenseEl = byId("about-license");
  licenseEl.textContent = licensed ? "License: Active" : "License: Unlicensed";
  licenseEl.style.color = licensed ? "var(--ok)" : "var(--danger)";

  const rows: [string, string][] = [];
  for (const [key, label] of LICENSE_FIELDS) {
    const v = info[key];
    if (!v) continue;
    rows.push([label, key === "License Type" ? v.charAt(0).toUpperCase() + v.slice(1) : v]);
  }
  const days = Number(info["Days Remaining"]);
  // radarsimc gives whole days left, not a date; a date rebuilt from that
  // could be a day early, so show the count as given.
  if (info["Days Remaining"] && Number.isFinite(days)) {
    rows.push(["Expires", `in ${days} day${days === 1 ? "" : "s"}`]);
  }
  byId("about-license-details").replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      return [dt, dd];
    }),
  );
  // Details start collapsed behind a toggle, which shows only when there is something behind it
  byId("btn-license-details").classList.toggle("hidden", !licensed || rows.length === 0);
  _setLicenseDetailsExpanded(false);
}

async function _openAbout(): Promise<void> {
  const versionEl = byId("about-version");
  byId("about-year").textContent = String(new Date().getFullYear());
  versionEl.textContent = "Checking...";
  byId("about-license").textContent = "";
  byId("btn-license-details").classList.add("hidden");
  _setLicenseDetailsExpanded(false);
  _showDialog("about-dialog-overlay", true);

  try {
    const [appVersion, result] = await Promise.all([window.api.getAppVersion(), window.api.checkLibrary()]);
    if (result.success && result.data) {
      const d = result.data;
      versionEl.textContent = `RadarSimApp v${appVersion} — RadarSimLib v${d.radarsimlib_version}`;
      _renderLicenseStatus(d.licensed, d.license_info);
      byId("btn-activate").classList.toggle("hidden", d.licensed);
    } else {
      versionEl.textContent = `RadarSimApp v${appVersion} — ${result.error || "Failed to check"}`;
    }
  } catch (err) {
    versionEl.textContent = (err as Error).message;
  }
}

async function _activateLicense(): Promise<void> {
  const statusEl = byId("license-dialog-status");
  const btn = byId<HTMLButtonElement>("btn-license-select");
  const fail = (msg: string): void => {
    statusEl.textContent = msg;
    statusEl.style.color = "var(--danger)";
  };
  btn.disabled = true;
  statusEl.textContent = "Activating...";
  statusEl.style.color = "var(--ink-2)";
  try {
    const result = await window.api.activateLicense();
    if (result.cancelled) {
      statusEl.textContent = "";
    } else if (result.success && result.data?.licensed) {
      _showDialog("license-dialog-overlay", false);
      byId("btn-activate").classList.add("hidden");
      const info = await window.api.checkLibrary().catch(() => null);
      _renderLicenseStatus(true, info?.success ? info.data?.license_info : undefined);
    } else {
      fail(result.error || "Activation failed. Please check the license file.");
    }
  } catch (err) {
    fail(`Error: ${(err as Error).message}`);
  } finally {
    btn.disabled = false;
  }
}

export function initLicense(): void {
  byId("btn-check-env").addEventListener("click", _openAbout);
  byId("btn-about-close").addEventListener("click", () => _showDialog("about-dialog-overlay", false));
  byId("btn-license-details").addEventListener("click", (e) => {
    _setLicenseDetailsExpanded((e.currentTarget as HTMLElement).getAttribute("aria-expanded") !== "true");
  });

  byId("btn-activate").addEventListener("click", () => {
    byId("license-dialog-status").textContent = "";
    _showDialog("license-dialog-overlay", true);
  });
  byId("btn-license-select").addEventListener("click", _activateLicense);
  for (const id of ["btn-license-cancel", "btn-license-close"]) {
    byId(id).addEventListener("click", () => _showDialog("license-dialog-overlay", false));
  }

  // Unlicensed at startup: offer to activate straight away
  window.api
    .checkLibrary()
    .then((result) => {
      if (!result.success || !result.data) return;
      byId("btn-activate").classList.toggle("hidden", result.data.licensed);
      if (!result.data.licensed) _showDialog("license-dialog-overlay", true);
    })
    .catch(() => {});
}
