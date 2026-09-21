(function () {
  "use strict";

  if (window.__nextFormBatchControllerLoaded) return;
  window.__nextFormBatchControllerLoaded = true;

  const core = globalThis.NextFormMetadataTool;
  const batch = globalThis.NextFormBatch;
  if (!core || !batch) return;

  const params = new URLSearchParams(location.search);
  const phongId = params.get("PhongId") || "unknown";
  const STORAGE_KEY = `nextform-batch-v1:${phongId}`;
  const DOSSIER_HEADERS = ["Trạng thái", "Danh sách văn bản"];
  const DOCUMENT_HEADERS = [
    "Mã văn bản", "Số và ký hiệu", "Trích yếu nội dung",
    "Ngày ban hành", "Cơ quan ban hành", "Thao tác"
  ];
  const LIST_SETTLE_MS = 1200;
  const PDF_STABLE_MS = 1500;

  function rootUrl() {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("PhongId", phongId);
    return url.href;
  }

  function defaultState() {
    return {
      runId: "",
      active: false,
      phase: "idle",
      rootUrl: rootUrl(),
      mainPage: 0,
      detailPage: 0,
      currentDossierKey: "",
      currentDossierTitle: "",
      currentDocumentKey: "",
      currentSaveStarted: false,
      cycleComplete: false,
      visitedDossiers: [],
      processedDossiers: [],
      attemptedDocuments: {},
      savedCount: 0,
      skippedCount: 0,
      failures: [],
      logs: []
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
      return saved && typeof saved === "object"
        ? { ...defaultState(), ...saved }
        : defaultState();
    } catch {
      return defaultState();
    }
  }

  function saveState(state, options = {}) {
    const nextState = batch.mergeRuntimeState(loadState(), state, options.allowRestart === true);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    updateUi(nextState);
    return nextState;
  }

  function addLog(state, message, kind = "info") {
    const time = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    state.logs = [...state.logs, { time, message, kind }].slice(-80);
    saveState(state);
  }

  function isVisible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function newRunId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function stoppedError() {
    const error = new Error("Đã dừng theo yêu cầu.");
    error.code = "NEXTFORM_BATCH_STOPPED";
    return error;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function ensureCurrentRun(state) {
    const latest = loadState();
    if (!latest.active || !state.runId || latest.runId !== state.runId) {
      throw stoppedError();
    }
    return latest;
  }

  function tableHeaders(table) {
    return Array.from(table.querySelectorAll("thead th, thead td"))
      .map((cell) => batch.clean(cell.innerText));
  }

  function tableData(table) {
    const rowElements = Array.from(table.querySelectorAll("tbody tr"));
    return {
      headers: tableHeaders(table),
      rowElements,
      rows: rowElements.map((row) => Array.from(row.children).map((cell) => batch.clean(cell.innerText)))
    };
  }

  function findTable(requiredHeaders) {
    return Array.from(document.querySelectorAll("table"))
      .filter(isVisible)
      .find((table) => {
        const headers = tableHeaders(table);
        return requiredHeaders.every((required) =>
          headers.some((header) => batch.comparable(header) === batch.comparable(required))
        );
      }) || null;
  }

  function findPagination() {
    return Array.from(document.querySelectorAll("table"))
      .filter(isVisible)
      .find((table) => table.querySelector("tfoot") && batch.paginationState(table.innerText)) || null;
  }

  function currentPagination() {
    const table = findPagination();
    return table ? batch.paginationState(table.innerText) : null;
  }

  function pageSignature(requiredHeaders) {
    const table = findTable(requiredHeaders);
    const firstRow = table?.querySelector("tbody tr");
    return `${currentPagination()?.from || 0}:${batch.clean(firstRow?.innerText || "")}`;
  }

  async function clickPager(state, direction, requiredHeaders) {
    const icons = {
      first: "fa-angle-double-left",
      previous: "fa-angle-left",
      next: "fa-angle-right",
      last: "fa-angle-double-right"
    };
    const pager = findPagination();
    const button = pager?.querySelector(`i.${icons[direction]}`)?.closest("button");
    if (!button || button.disabled || button.classList.contains("disabled")) return false;
    ensureCurrentRun(state);
    const before = pageSignature(requiredHeaders);
    button.click();
    await core.waitFor(() => pageSignature(requiredHeaders) !== before, 10000);
    ensureCurrentRun(state);
    return true;
  }

  async function goToPage(state, targetPage, requiredHeaders) {
    await core.waitFor(() => findTable(requiredHeaders), 15000);
    ensureCurrentRun(state);
    let pagination = currentPagination();
    if (!pagination) return;
    if (pagination.pageIndex > targetPage) {
      await clickPager(state, "first", requiredHeaders);
      pagination = currentPagination();
    }
    while (pagination && pagination.pageIndex < targetPage) {
      if (!(await clickPager(state, "next", requiredHeaders))) break;
      pagination = currentPagination();
    }
  }

  function rowAction(row, matcher) {
    return Array.from(row.querySelectorAll("button, a")).find(matcher) || null;
  }

  function tableShowsNoData(table) {
    return /không\s+có\s+dữ\s+liệu|no\s+data/iu.test(batch.clean(table?.innerText));
  }

  async function waitForDocumentTable(state) {
    const table = await core.waitFor(() => {
      const candidate = findTable(DOCUMENT_HEADERS);
      if (!candidate) return null;
      const data = tableData(candidate);
      return batch.hasIdentifiedRows(data.headers, data.rows) || tableShowsNoData(candidate)
        ? candidate
        : null;
    }, 30000);
    ensureCurrentRun(state);
    await delay(LIST_SETTLE_MS);
    ensureCurrentRun(state);
    return core.waitFor(() => {
      const candidate = findTable(DOCUMENT_HEADERS);
      if (!candidate) return null;
      const data = tableData(candidate);
      return batch.hasIdentifiedRows(data.headers, data.rows) || tableShowsNoData(candidate)
        ? candidate
        : null;
    }, 10000);
  }

  async function waitForStablePdfLines(state, timeout = 30000) {
    const started = Date.now();
    let previousSignature = "";
    let stableSince = 0;

    while (Date.now() - started < timeout) {
      ensureCurrentRun(state);
      const lines = core.parser.readPdfTextLayer(document);
      const signature = lines.map((line) => line.text).join("\n");
      if (signature && signature === previousSignature) {
        if (Date.now() - stableSince >= PDF_STABLE_MS) return lines;
      } else {
        previousSignature = signature;
        stableSince = Date.now();
      }
      await delay(150);
    }

    throw new Error("PDF chưa tải xong lớp văn bản sau 30 giây.");
  }

  function closeEditor() {
    const dialog = core.findDialog();
    const close = dialog?.querySelector("button.btn-close");
    if (close) close.click();
  }

  function visiblePopup() {
    return Array.from(document.querySelectorAll(".swal2-popup, [role='alertdialog']"))
      .find(isVisible) || null;
  }

  async function dismissPopup(popup) {
    const button = popup.querySelector(".swal2-confirm") ||
      Array.from(popup.querySelectorAll("button")).find((item) => /^(OK|Đồng ý|Xác nhận)$/iu.test(batch.clean(item.innerText))) ||
      popup.querySelector("button");
    button?.click();
    try {
      await core.waitFor(() => !isVisible(popup), 5000);
    } catch {
      // Popup có thể bị React gỡ khỏi DOM ngay sau khi bấm.
    }
  }

  async function fillSaveAndReadResult(state) {
    await core.waitFor(
      () => core.findDialog(),
      20000,
      "Không mở được cửa sổ cập nhật văn bản sau 20 giây."
    );
    ensureCurrentRun(state);
    await delay(LIST_SETTLE_MS);
    const pdfLines = await waitForStablePdfLines(state);

    const metadata = core.parser.parseDocument(pdfLines);
    if (metadata.errors.length) throw new Error(metadata.errors.join(" "));
    await core.fillForm(metadata);
    ensureCurrentRun(state);

    const submit = core.findSaveButton();
    if (!submit) throw new Error("Không tìm thấy nút Lưu thông tin.");

    state.currentSaveStarted = true;
    saveState(state);
    ensureCurrentRun(state);
    submit.click();

    const popup = await core.waitFor(
      () => visiblePopup(),
      30000,
      "Hệ thống không trả về thông báo kết quả lưu sau 30 giây."
    );
    ensureCurrentRun(state);
    const message = batch.clean(popup.innerText) || "Popup không có nội dung";
    const success = Boolean(popup.querySelector(".swal2-success, .swal2-icon-success")) ||
      /thành công|success/iu.test(message);
    await dismissPopup(popup);
    state.currentSaveStarted = false;
    saveState(state);
    if (!success) throw new Error(message);
    try {
      await core.waitFor(() => !core.findDialog(), 8000);
    } catch {
      closeEditor();
    }
    return message;
  }

  function documentAttemptedSet(state) {
    return new Set(state.attemptedDocuments[state.currentDossierKey] || []);
  }

  function markDocumentAttempted(state, key) {
    const attempted = documentAttemptedSet(state);
    attempted.add(key);
    state.attemptedDocuments[state.currentDossierKey] = Array.from(attempted);
  }

  async function processDetail(state) {
    state.phase = "detail";
    saveState(state);

    if (state.currentSaveStarted && state.currentDocumentKey) {
      markDocumentAttempted(state, state.currentDocumentKey);
      state.failures.push({
        dossier: state.currentDossierKey,
        document: state.currentDocumentKey,
        message: "Trang tải lại sau khi bấm lưu; kết quả chưa xác định, không tự lưu lần hai."
      });
      state.currentSaveStarted = false;
      state.currentDocumentKey = "";
      addLog(state, "Bỏ qua một văn bản có kết quả lưu chưa xác định để tránh lưu trùng.", "warn");
    }

    await goToPage(state, state.detailPage, DOCUMENT_HEADERS);

    while (true) {
      ensureCurrentRun(state);
      const table = await waitForDocumentTable(state);
      const data = tableData(table);
      const targets = batch.findIncompleteDocuments(data.headers, data.rows, documentAttemptedSet(state));

      if (targets.length) {
        const target = targets[0];
        const row = data.rowElements[target.rowIndex];
        const edit = rowAction(row, (element) =>
          batch.comparable(element.title) === batch.comparable("Sửa") ||
          element.classList.contains("icon-edit")
        );
        if (!edit) {
          markDocumentAttempted(state, target.key);
          state.skippedCount += 1;
          addLog(state, `${target.key}: thiếu ${target.missing.join(", ")} nhưng không tìm thấy nút Sửa.`, "error");
          continue;
        }

        state.currentDocumentKey = target.key;
        saveState(state);
        addLog(state, `${target.key}: đang bổ sung ${target.missing.join(", ")}.`);
        ensureCurrentRun(state);
        edit.click();
        await delay(LIST_SETTLE_MS);
        ensureCurrentRun(state);

        try {
          const result = await fillSaveAndReadResult(state);
          state.savedCount += 1;
          addLog(state, `${target.key}: ${result}`, "ok");
        } catch (error) {
          if (error.code === "NEXTFORM_BATCH_STOPPED") {
            const popup = visiblePopup();
            if (popup) await dismissPopup(popup);
            closeEditor();
            throw error;
          }
          state.failures.push({
            dossier: state.currentDossierKey,
            document: target.key,
            message: error.message
          });
          addLog(state, `${target.key}: ${error.message}`, "error");
          const popup = visiblePopup();
          if (popup) await dismissPopup(popup);
          closeEditor();
        }

        markDocumentAttempted(state, target.key);
        state.currentDocumentKey = "";
        state.currentSaveStarted = false;
        saveState(state);
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }

      const pagination = currentPagination();
      if (pagination && !pagination.isLast) {
        await clickPager(state, "next", DOCUMENT_HEADERS);
        state.detailPage = currentPagination()?.pageIndex ?? state.detailPage + 1;
        saveState(state);
        continue;
      }

      if (!state.processedDossiers.includes(state.currentDossierKey)) {
        state.processedDossiers.push(state.currentDossierKey);
      }
      addLog(state, `Đã kiểm tra xong hồ sơ ${state.currentDossierKey}.`, "ok");
      state.phase = "main";
      state.detailPage = 0;
      state.currentDocumentKey = "";
      saveState(state);
      ensureCurrentRun(state);
      location.assign(state.rootUrl);
      return;
    }
  }

  async function processMain(state) {
    state.phase = "main";
    saveState(state);
    await goToPage(state, state.mainPage, DOSSIER_HEADERS);

    while (true) {
      ensureCurrentRun(state);
      const table = await core.waitFor(() => findTable(DOSSIER_HEADERS), 15000);
      ensureCurrentRun(state);
      const data = tableData(table);
      const visited = new Set([...state.processedDossiers, ...state.visitedDossiers]);
      const targets = batch.findNewDossiers(data.headers, data.rows, visited);

      if (targets.length) {
        const target = targets[0];
        const row = data.rowElements[target.rowIndex];
        const open = rowAction(row, (element) => /Xem\s+danh\s+sách/iu.test(element.innerText));
        if (!open) {
          if (!state.visitedDossiers.includes(target.key)) state.visitedDossiers.push(target.key);
          state.processedDossiers.push(target.key);
          state.failures.push({ dossier: target.key, document: "", message: "Không tìm thấy nút Xem danh sách." });
          addLog(state, `${target.key}: không tìm thấy nút Xem danh sách.`, "error");
          continue;
        }

        state.currentDossierKey = target.key;
        state.currentDossierTitle = target.title;
        if (!state.visitedDossiers.includes(target.key)) state.visitedDossiers.push(target.key);
        state.mainPage = currentPagination()?.pageIndex ?? state.mainPage;
        state.detailPage = 0;
        state.phase = "detail";
        saveState(state);
        addLog(state, `Mở hồ sơ ${target.key}: ${target.title}.`);
        ensureCurrentRun(state);
        open.click();
        await core.waitFor(() => findTable(DOCUMENT_HEADERS), 20000);
        await delay(LIST_SETTLE_MS);
        ensureCurrentRun(state);
        await processDetail(state);
        return;
      }

      const pagination = currentPagination();
      if (pagination && !pagination.isLast) {
        await clickPager(state, "next", DOSSIER_HEADERS);
        state.mainPage = currentPagination()?.pageIndex ?? state.mainPage + 1;
        saveState(state);
        continue;
      }

      state.active = false;
      state.phase = "complete";
      state.cycleComplete = true;
      addLog(
        state,
        `Hoàn tất: ${state.savedCount} văn bản đã lưu, ${state.failures.length} lỗi, ${state.skippedCount} bỏ qua.`,
        state.failures.length ? "warn" : "ok"
      );
      return;
    }
  }

  async function runBatch() {
    if (window.__nextFormBatchRunning) return;
    const state = loadState();
    if (!state.active) return;
    if (state.cycleComplete) return;
    if (!state.runId) {
      state.active = false;
      state.phase = "stopped";
      addLog(state, "Đã dừng phiên chạy cũ sau khi cập nhật tiện ích. Hãy bấm Chạy từ đầu để tạo phiên mới.", "warn");
      return;
    }
    window.__nextFormBatchRunning = true;
    try {
      if (new URLSearchParams(location.search).has("HoSoId")) {
        await processDetail(state);
      } else {
        await processMain(state);
      }
    } catch (error) {
      const latest = loadState();
      if (error.code === "NEXTFORM_BATCH_STOPPED" || !latest.active || latest.runId !== state.runId) {
        updateUi(latest);
        return;
      }
      latest.active = false;
      latest.phase = "error";
      latest.failures.push({
        dossier: latest.currentDossierKey,
        document: latest.currentDocumentKey,
        message: error.message
      });
      addLog(latest, `Đã dừng do lỗi: ${error.message}`, "error");
    } finally {
      window.__nextFormBatchRunning = false;
    }
  }

  function updateUi(state = loadState()) {
    const progress = document.querySelector("#nextform-batch-progress");
    const log = document.querySelector("#nextform-batch-log");
    const start = document.querySelector("#nextform-batch-start");
    const stop = document.querySelector("#nextform-batch-stop");
    const manual = document.querySelector("#nextform-batch-manual-scan");
    if (progress) {
      progress.textContent = state.active
        ? `Đang chạy · ${state.savedCount} đã lưu · ${state.failures.length} lỗi`
        : state.phase === "complete"
          ? `Hoàn tất · ${state.savedCount} đã lưu · ${state.failures.length} lỗi`
          : state.phase === "stopped"
            ? `Đã dừng · ${state.savedCount} đã lưu · ${state.failures.length} lỗi`
          : "Chưa chạy";
      progress.dataset.kind = state.failures.length
        ? "warn"
        : state.active || state.phase === "complete" ? "ok" : "info";
    }
    if (log) {
      log.innerHTML = state.logs.slice(-12).reverse().map((item) =>
        `<div data-kind="${item.kind}"><time>${item.time}</time> ${escapeHtml(item.message)}</div>`
      ).join("") || "<div>Chưa có nhật ký.</div>";
    }
    if (start) start.disabled = state.active;
    if (stop) stop.disabled = !state.active;
    if (manual) {
      manual.hidden = false;
      manual.disabled = state.active || !core.findDialog();
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function createBatchUi() {
    const body = document.querySelector("#nextform-tool-body");
    const status = document.querySelector("#nextform-tool-status");
    if (!body || !status) return;
    const section = document.createElement("section");
    section.id = "nextform-batch-section";
    section.innerHTML = `
      <div class="nextform-batch-title">Xử lý hàng loạt</div>
      <div id="nextform-batch-progress" data-kind="info">Chưa chạy</div>
      <div class="nextform-batch-actions">
        <button id="nextform-batch-start" type="button">Chạy từ đầu</button>
        <button id="nextform-batch-stop" type="button">Dừng</button>
        <button id="nextform-batch-manual-scan" type="button">Quét thủ công</button>
      </div>
      <div id="nextform-batch-log"></div>
    `;
    body.insertBefore(section, status);

    section.querySelector("#nextform-batch-start").addEventListener("click", () => {
      const confirmed = window.confirm(
        "Tiện ích sẽ duyệt toàn bộ hồ sơ trạng thái “Mới”, tự điền và bấm “Lưu thông tin” cho mọi văn bản thiếu metadata. Bạn xác nhận bắt đầu ghi dữ liệu hàng loạt lên hệ thống?"
      );
      if (!confirmed) return;
      const state = defaultState();
      state.runId = newRunId();
      state.active = true;
      state.phase = "main";
      state.cycleComplete = false;
      saveState(state, { allowRestart: true });
      addLog(state, "Bắt đầu xử lý hàng loạt từ trang đầu.");
      if (location.href !== state.rootUrl) {
        location.assign(state.rootUrl);
      } else if (window.__nextFormBatchRunning) {
        location.reload();
      } else {
        runBatch();
      }
    });

    section.querySelector("#nextform-batch-stop").addEventListener("click", () => {
      const state = loadState();
      state.active = false;
      state.phase = "stopped";
      addLog(state, "Đã yêu cầu dừng. Tiện ích sẽ không mở hoặc lưu văn bản tiếp theo.", "warn");
    });

    section.querySelector("#nextform-batch-manual-scan").addEventListener("click", async () => {
      const state = loadState();
      if (state.active || !core.findDialog()) return;
      const manualButton = section.querySelector("#nextform-batch-manual-scan");
      manualButton.disabled = true;
      try {
        await core.prepareManualReview();
        addLog(state, "Đã đưa dữ liệu PDF đang mở lên giao diện để kiểm tra thủ công.", "info");
      } catch (error) {
        core.showStatus(error.message, "error");
        addLog(state, `Quét thủ công chưa thành công: ${error.message}`, "error");
      } finally {
        updateUi();
      }
    });

    updateUi();
  }

  createBatchUi();
  let dialogRefreshTimer = 0;
  let dialogWasOpen = Boolean(core.findDialog());
  const dialogObserver = new MutationObserver(() => {
    clearTimeout(dialogRefreshTimer);
    dialogRefreshTimer = setTimeout(() => {
      const dialogIsOpen = Boolean(core.findDialog());
      if (dialogIsOpen === dialogWasOpen) return;
      dialogWasOpen = dialogIsOpen;
      if (!dialogIsOpen) {
        core.finishManualReview();
        const coreSection = document.querySelector("#nextform-core-section");
        if (coreSection) coreSection.hidden = true;
      }
      updateUi();
    }, 120);
  });
  dialogObserver.observe(document.body, { childList: true, subtree: true });
  if (!core.findDialog()) {
    const coreSection = document.querySelector("#nextform-core-section");
    if (coreSection) coreSection.hidden = true;
  }
  if (loadState().active) setTimeout(runBatch, 250);
})();
