(function () {
  "use strict";

  if (window.__nextFormMetadataToolLoaded) return;
  window.__nextFormMetadataToolLoaded = true;

  const parser = globalThis.NextFormMetadataParser;
  const FIELD_CONFIG = [
    ["documentType", "Loại văn bản"],
    ["issueDate", "Ngày ban hành"],
    ["issuingAgency", "Cơ quan ban hành"],
    ["documentNumber", "Số hiệu văn bản"],
    ["summary", "Trích yếu"]
  ];

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(find, timeout = 5000, errorMessage = "Trang chưa hiển thị trường cần thao tác.") {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const result = find();
      if (result) return result;
      await sleep(80);
    }
    throw new Error(errorMessage);
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("Không thể ghi giá trị vào trường nhập liệu.");
    setter.call(element, value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function typeReactSelectSearch(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Không thể nhập từ khóa vào ô Loại văn bản.");
    input.click();
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value
    }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function normalize(value) {
    return parser.comparable(value);
  }

  function findDialog() {
    return Array.from(document.querySelectorAll("[role='dialog']"))
      .find((dialog) =>
        dialog.getClientRects().length > 0 &&
        getComputedStyle(dialog).visibility !== "hidden" &&
        /Lưu\s+thông\s+tin/iu.test(dialog.innerText)
      );
  }

  function findField(placeholder) {
    const dialog = findDialog();
    return dialog?.querySelector(`[placeholder="${CSS.escape(placeholder)}"]`) || null;
  }

  async function selectDocumentType(type) {
    const dialog = findDialog();
    if (!dialog) throw new Error("Không tìm thấy cửa sổ cập nhật văn bản.");

    const title = Array.from(dialog.querySelectorAll("p, label, div"))
      .find((element) => normalize(element.textContent) === normalize("Loại văn bản *") || normalize(element.textContent) === normalize("Loại văn bản"));
    const item = title?.closest(".item") || title?.parentElement;
    const selectInput = item?.querySelector("input[id^='react-select-']");
    if (!selectInput) throw new Error("Không tìm thấy ô Loại văn bản.");

    const current = item.querySelector(".select__single-value")?.textContent || "";
    if (normalize(current) === normalize(type)) return;

    typeReactSelectSearch(selectInput, type);

    const option = await waitFor(
      () => Array.from(document.querySelectorAll("[role='option'], .select__option"))
        .find((element) => normalize(element.textContent) === normalize(type)),
      5000,
      `Đã nhập “${type}” nhưng không tìm thấy option tương ứng sau 5 giây.`
    );
    option.click();
    await waitFor(
      () => findField("Nhập ngày ban hành"),
      8000,
      "Đã chọn Loại văn bản nhưng các trường metadata chưa xuất hiện sau 8 giây."
    );
    await sleep(500);
  }

  function valuesFromPanel() {
    return Object.fromEntries(FIELD_CONFIG.map(([key]) => [key, document.querySelector(`[data-nextform-field="${key}"]`)?.value.trim() || ""]));
  }

  async function fillForm(values) {
    if (!values.documentType) throw new Error("Loại văn bản đang trống.");
    await selectDocumentType(values.documentType);

    const mappings = [
      ["Nhập ngày ban hành", values.issueDate],
      ["Nhập tên cơ quan, tổ chức, cá nhân ban hành tài liệu", values.issuingAgency],
      ["Nhập số hiệu văn bản, mã số đăng ký", values.documentNumber],
      ["Nhập trích yếu", values.summary]
    ];
    for (const [placeholder, value] of mappings) {
      const field = await waitFor(
        () => findField(placeholder),
        20000,
        `Không tìm thấy trường “${placeholder}” sau 20 giây.`
      );
      setNativeValue(field, value);
      await sleep(150);
    }
  }

  function findSaveButton() {
    const dialog = findDialog();
    return Array.from(dialog?.querySelectorAll("button") || [])
      .find((button) => normalize(button.textContent) === normalize("Lưu thông tin"));
  }

  function showStatus(message, kind = "info") {
    const status = document.querySelector("#nextform-tool-status");
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function refreshPreview() {
    try {
      const domTextLines = parser.readPdfTextLayer(document);
      if (!domTextLines.length) {
        showStatus("Trang danh sách: dùng phần Xử lý hàng loạt bên dưới.", "info");
        return null;
      }
      const metadata = parser.parseDocument(domTextLines);
      for (const [key] of FIELD_CONFIG) {
        const input = document.querySelector(`[data-nextform-field="${key}"]`);
        if (input) input.value = metadata[key] || "";
      }
      showStatus(
        metadata.errors.length
          ? `Đã đọc ${domTextLines.length} phần tử DOM. ${metadata.errors.join(" ")}`
          : `Đã đọc ${domTextLines.length} phần tử DOM từ cột PDF. Hãy kiểm tra dữ liệu trước khi điền.`,
        metadata.errors.length ? "warn" : "ok"
      );
      return metadata;
    } catch (error) {
      showStatus(error.message, "error");
      return null;
    }
  }

  async function handleFill(saveAfterFill) {
    const fillButton = document.querySelector("#nextform-tool-fill");
    const saveButton = document.querySelector("#nextform-tool-fill-save");
    fillButton.disabled = saveButton.disabled = true;
    try {
      const values = valuesFromPanel();
      const missing = FIELD_CONFIG.filter(([key]) => !values[key]).map(([, label]) => label);
      if (missing.length) throw new Error(`Còn thiếu: ${missing.join(", ")}.`);
      await fillForm(values);
      showStatus("Đã điền đủ 5 trường vào biểu mẫu.", "ok");

      if (saveAfterFill) {
        const confirmed = window.confirm(
          "Dữ liệu đã được điền vào biểu mẫu. Bạn có chắc muốn bấm “Lưu thông tin” và ghi dữ liệu lên hệ thống không?"
        );
        if (!confirmed) {
          showStatus("Đã điền nhưng chưa lưu. Bạn có thể kiểm tra lại trên biểu mẫu.", "warn");
          return;
        }
        const submit = findSaveButton();
        if (!submit) throw new Error("Không tìm thấy nút Lưu thông tin.");
        submit.click();
        showStatus("Đã bấm Lưu thông tin. Hãy kiểm tra thông báo của hệ thống.", "ok");
      }
    } catch (error) {
      showStatus(error.message, "error");
    } finally {
      fillButton.disabled = saveButton.disabled = false;
    }
  }

  function createPanel() {
    const panel = document.createElement("section");
    panel.id = "nextform-tool";
    panel.innerHTML = `
      <button id="nextform-tool-toggle" type="button" aria-expanded="true">NF</button>
      <div id="nextform-tool-body">
        <div class="nextform-tool-header">
          <strong>Tự động điền metadata</strong>
          <button id="nextform-tool-close" type="button" title="Thu gọn">×</button>
        </div>
        <div id="nextform-core-section">
          <div class="nextform-tool-grid">
            ${FIELD_CONFIG.map(([key, label]) => `
              <label>${label}
                ${key === "summary"
                  ? `<textarea data-nextform-field="${key}" rows="3"></textarea>`
                  : `<input data-nextform-field="${key}" type="text">`}
              </label>
            `).join("")}
          </div>
          <div class="nextform-tool-actions">
            <button id="nextform-tool-read" type="button">Đọc lại PDF</button>
            <button id="nextform-tool-fill" type="button">Điền biểu mẫu</button>
            <button id="nextform-tool-fill-save" type="button">Điền và lưu</button>
          </div>
        </div>
        <div id="nextform-tool-status" data-kind="info">Bấm “Đọc lại PDF” để bắt đầu.</div>
      </div>
    `;
    document.body.appendChild(panel);

    const body = panel.querySelector("#nextform-tool-body");
    const toggle = panel.querySelector("#nextform-tool-toggle");
    const collapse = () => {
      body.hidden = true;
      toggle.hidden = false;
      toggle.setAttribute("aria-expanded", "false");
    };
    panel.querySelector("#nextform-tool-close").addEventListener("click", collapse);
    toggle.addEventListener("click", () => {
      body.hidden = false;
      toggle.hidden = true;
      toggle.setAttribute("aria-expanded", "true");
    });
    toggle.hidden = true;
    panel.querySelector("#nextform-tool-read")?.addEventListener("click", refreshPreview);
    panel.querySelector("#nextform-tool-fill")?.addEventListener("click", () => handleFill(false));
    panel.querySelector("#nextform-tool-fill-save")?.addEventListener("click", () => handleFill(true));
    refreshPreview();
  }

  globalThis.NextFormMetadataTool = {
    FIELD_CONFIG,
    fillForm,
    findDialog,
    findSaveButton,
    normalize,
    parser,
    refreshPreview,
    setNativeValue,
    showStatus,
    typeReactSelectSearch,
    waitFor
  };

  createPanel();
})();
