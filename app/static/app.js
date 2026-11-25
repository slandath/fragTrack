// fragTrack compare client: POST creates a refresh job, then an
// EventSource streams per-retailer results and the rows fill in as
// events land. No framework, no polling, no full-page spinner.

const fmtTime = (s) => (s ? s.replace("T", " ").slice(0, 16) : "never");

function statusText(ev) {
  if (ev.status === "ok") return "confirmed " + fmtTime(ev.lastSuccessAt);
  if (ev.status === "failed")
    return (
      "price from " + fmtTime(ev.lastSuccessAt) + ", refresh failed " + fmtTime(ev.lastAttemptAt)
    );
  if (ev.status === "blocked")
    return "price from " + fmtTime(ev.lastSuccessAt) + ", blocked " + fmtTime(ev.lastAttemptAt);
  return "no check yet";
}

function priceText(ev) {
  if (ev.priceMinor == null) return "—";
  return (ev.priceCurrency || "USD") + " " + (ev.priceMinor / 100).toFixed(2);
}

async function runCompare(fragranceID) {
  const statusLine = document.querySelector('[data-status-line="' + fragranceID + '"]');
  const table = document.querySelector('[data-rows="' + fragranceID + '"]');
  if (!table) return;
  statusLine.textContent = "Checking all retailers…";

  const resp = await fetch("/api/fragrances/" + fragranceID + "/refresh-prices", {
    method: "POST",
  });
  if (!resp.ok) {
    statusLine.textContent = "Could not start a refresh.";
    return;
  }
  const { jobId } = await resp.json();
  const es = new EventSource("/api/refreshes/" + jobId + "/events");

  es.addEventListener("result", (e) => {
    const ev = JSON.parse(e.data);
    const row = table.querySelector('tr[data-retailer="' + ev.retailer + '"]');
    if (!row) return;
    row.querySelector("[data-price-cell]").textContent = priceText(ev);
    row.querySelector("[data-fresh-cell]").textContent = statusText(ev);
  });
  es.addEventListener("failed", (e) => {
    const ev = JSON.parse(e.data);
    const row = table.querySelector('tr[data-retailer="' + ev.retailer + '"]');
    if (!row) return;
    row.querySelector("[data-fresh-cell]").textContent = statusText(ev);
  });
  es.addEventListener("blocked", (e) => {
    const ev = JSON.parse(e.data);
    const row = table.querySelector('tr[data-retailer="' + ev.retailer + '"]');
    if (!row) return;
    row.querySelector("[data-fresh-cell]").textContent = statusText(ev);
  });
  es.addEventListener("complete", () => {
    statusLine.textContent = "Done.";
    es.close();
  });
  es.onerror = (e) => {
    // A dropped stream mid-job is not a failure: pending rows keep
    // their previous snapshot until the next tap.
    if (es.readyState === EventSource.CLOSED) {
      statusLine.textContent = "Stream closed before completion.";
    }
  };
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-compare]");
  if (btn) runCompare(btn.dataset.compare);
});
