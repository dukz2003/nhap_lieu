(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NextFormMetadataParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DOCUMENT_TYPES = [
    "Nghị quyết",
    "Quyết định",
    "Chỉ thị",
    "Quy chế",
    "Quy định",
    "Thông cáo",
    "Thông báo",
    "Hướng dẫn",
    "Chương trình",
    "Giấy chứng nhận đủ điều kiện về an ninh, trật tự",
    "Thông tư",
    "Giấy chứng nhận",
    "Kế hoạch",
    "Phương án",
    "Đề án",
    "Dự án",
    "Báo cáo",
    "Tờ trình",
    "Giấy uỷ quyền",
    "Phiếu gửi"
  ];

  function clean(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:])/g, "$1")
      .trim();
  }

  function comparable(value) {
    return clean(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .replace(/[:.]+$/g, "")
      .toLocaleUpperCase("vi-VN");
  }

  function percentage(styleValue) {
    const match = String(styleValue || "").match(/(-?\d+(?:\.\d+)?)%/);
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
  }

  function canonicalAgency(value) {
    let agency = clean(value);
    if (/^UỶ(?:\s|$)/iu.test(agency)) agency = `ỦY${agency.slice(2)}`;
    return agency.toLocaleUpperCase("vi-VN");
  }

  function titleCaseType(type) {
    const key = comparable(type);
    return DOCUMENT_TYPES.find((item) => comparable(item) === key) || clean(type);
  }

  function diacriticScore(value) {
    return (String(value || "").normalize("NFD").match(/[\u0300-\u036f]/g) || []).length;
  }

  function recoverLocality(lines, headerLocality) {
    if (!headerLocality) return "";
    const target = comparable(headerLocality);
    const pattern = /(?:TỈNH|THÀNH PHỐ|HUYỆN|THỊ XÃ|QUẬN|XÃ|PHƯỜNG|THỊ TRẤN)\s+[^,.;:]+/giu;
    const candidates = [headerLocality];
    for (const line of lines) {
      for (const match of line.text.matchAll(pattern)) {
        const candidate = clean(match[0]);
        if (comparable(candidate) === target) candidates.push(candidate);
      }
    }
    return candidates.sort((a, b) => diacriticScore(b) - diacriticScore(a))[0];
  }

  function normalizePersonName(value) {
    return clean(value)
      .split(" ")
      .map((word) => word
        ? word[0].toLocaleUpperCase("vi-VN") + word.slice(1).toLocaleLowerCase("vi-VN")
        : word)
      .join(" ");
  }

  function parseIssueDate(value) {
    const match = String(value || "").match(
      /ngày\s*(\d{1,2})\s*tháng\s*(\d{1,2})\s*năm\s*(\d{4})/u
    );
    if (!match) return "";

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2100) return "";
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  }

  function parseDocument(lines) {
    const normalizedLines = (lines || [])
      .map((line, index) => ({
        text: clean(typeof line === "string" ? line : line.text),
        top: Number.isFinite(line && line.top) ? line.top : Number.POSITIVE_INFINITY,
        left: Number.isFinite(line && line.left) ? line.left : Number.POSITIVE_INFINITY,
        index
      }))
      .filter((line) => line.text);

    const fullText = normalizedLines.map((line) => line.text).join("\n");
    const errors = [];

    const typeCandidates = normalizedLines.filter((line) => line.top < 35 || !Number.isFinite(line.top));
    let documentType = "";
    for (const expected of DOCUMENT_TYPES) {
      const found = typeCandidates.find((line) => comparable(line.text) === comparable(expected));
      if (found) {
        documentType = titleCaseType(expected);
        break;
      }
    }
    if (!documentType) errors.push("Không nhận diện được loại văn bản.");

    const issueDate = parseIssueDate(fullText);
    if (!issueDate) errors.push("Không nhận diện được ngày ban hành.");

    const numberLine = normalizedLines.find((line) => /^\s*Số\s*:/iu.test(line.text));
    const documentNumber = numberLine ? clean(numberLine.text.replace(/^\s*Số\s*:\s*/iu, "")) : "";
    if (!documentNumber) errors.push("Không nhận diện được số hiệu văn bản.");

    const headerLines = normalizedLines.filter((line) => line.top < 18 && line.left < 40);
    const agencyRoot = headerLines.find((line) => /(?:UỶ|ỦY)\s+BAN\s+NHÂN\s+DÂN/iu.test(line.text));
    const locality = headerLines.find((line) => /^(?:TỈNH|THÀNH PHỐ|HUYỆN|THỊ XÃ|QUẬN|XÃ|PHƯỜNG|THỊ TRẤN)(?:\s|$)/iu.test(line.text));
    const recoveredLocality = recoverLocality(normalizedLines, locality?.text || "");
    let issuingAgency = agencyRoot ? agencyRoot.text : (recoveredLocality ? "ỦY BAN NHÂN DÂN" : "");
    if (recoveredLocality && !comparable(issuingAgency).includes(comparable(recoveredLocality))) {
      issuingAgency = clean(`${issuingAgency} ${recoveredLocality}`);
    }
    issuingAgency = canonicalAgency(issuingAgency);
    if (!issuingAgency) errors.push("Không nhận diện được cơ quan ban hành.");

    const subjectLine = normalizedLines.find((line) => /^Về\s+việc\b/iu.test(line.text));
    const articleOne = normalizedLines.find((line) => /^Điều\s*1\s*[.:]/iu.test(line.text));
    let person = "";
    if (articleOne) {
      const personMatch = articleOne.text.match(/(ông|bà)\s+([^,.;]+)/iu);
      if (personMatch) {
        person = clean(`${personMatch[1].toLocaleLowerCase("vi-VN")} ${normalizePersonName(personMatch[2])}`);
      }
    }
    let summary = subjectLine ? subjectLine.text.replace(/[.:;]+$/u, "") : "";
    if (person && !comparable(summary).includes(comparable(person))) summary = clean(`${summary} ${person}`);
    if (!summary) errors.push("Không nhận diện được trích yếu.");

    return {
      documentType,
      issueDate,
      issuingAgency,
      documentNumber,
      summary,
      errors
    };
  }

  function readPdfTextLayer(doc) {
    // Dữ liệu chạy thật luôn được lấy từ DOM của cột PDF bên trái.
    // Không dùng nội dung của file test hay bất kỳ giá trị văn bản cố định nào.
    const pdfColumn = doc.querySelector?.("[role='dialog'] .form-view-pdf-custom") || doc;
    return Array.from(pdfColumn.querySelectorAll(".rpv-core__text-layer-text[role='presentation']"))
      .map((element, index) => ({
        text: clean(element.textContent),
        top: percentage(element.style.top),
        left: percentage(element.style.left),
        index
      }))
      .filter((line) => line.text)
      .sort((a, b) => (a.top - b.top) || (a.left - b.left) || (a.index - b.index));
  }

  return { DOCUMENT_TYPES, clean, comparable, parseDocument, parseIssueDate, readPdfTextLayer };
});
