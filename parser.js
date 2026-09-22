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

  function isStructuralHeading(value) {
    return /^(?:QUYẾT ĐỊNH|ĐIỀU\s*\d|CĂN CỨ|(?:UỶ|ỦY)\s+BAN|CHỦ TỊCH|SỐ\s*:?(?:\s|$)|ĐỘC LẬP|CỘNG HÒA|CỘNG HOÀ)/iu.test(clean(value));
  }

  function collectSubjectText(lines, startIndex) {
    const first = lines[startIndex];
    if (!first) return "";
    const parts = [first.text];
    if (!Number.isFinite(first.top)) return clean(parts.join(" "));

    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.page !== first.page || !Number.isFinite(line.top)) break;
      const distance = line.top - first.top;
      if (distance <= 0 || distance > 6 || isStructuralHeading(line.text)) break;
      parts.push(line.text);
    }
    return clean(parts.join(" "));
  }

  function normalizeHonorificSeparators(value) {
    return clean(value).replace(/\s*\?\s*(?=(?:ông|bà)(?:\s|:|$))/iu, " - ");
  }

  function containsHonorific(value) {
    if (/(?:^|[^\p{L}])(ông|bà)(?=\s|:|$)/iu.test(value)) return true;
    return /(?:^|[^A-Z])(ONG|BA)(?=\s|:|$)/u.test(comparable(value));
  }

  function numberValueFromText(value) {
    const match = clean(value).match(/^Số\s*:?\s*(.*)$/iu);
    return match ? clean(match[1]) : "";
  }

  function looksLikeDocumentNumber(value) {
    const candidate = clean(value);
    if (!candidate || !/\d/u.test(candidate)) return false;
    const compact = candidate.replace(/\s+/g, "");
    if (!/^[\p{L}\p{N}._/-]+$/u.test(compact)) return false;
    return /[/-]/u.test(compact) || /^\d+[A-Za-z]?$/u.test(compact);
  }

  function documentNumberCandidate(lines, index) {
    const line = lines[index];
    let value = numberValueFromText(line.text);
    if (looksLikeDocumentNumber(value)) return value;

    const next = lines[index + 1];
    if (!next || next.page !== line.page || !Number.isFinite(line.top) || !Number.isFinite(next.top)) return "";
    if (Math.abs(next.top - line.top) > 2.5) return "";
    const combined = clean(`${value} ${next.text}`);
    return looksLikeDocumentNumber(combined) ? combined : "";
  }

  function findDocumentNumber(lines, preferredPages) {
    const candidates = lines.flatMap((line, index) =>
      /^Số\s*:?\s*.*$/iu.test(line.text)
        ? [{ page: line.page, value: documentNumberCandidate(lines, index) }]
        : []
    ).filter((candidate) => candidate.value);

    for (const page of preferredPages) {
      const found = candidates.find((candidate) => candidate.page === page);
      if (found) return found.value;
    }
    return "";
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
        page: Number.isFinite(line && line.page) ? line.page : 0,
        index
      }))
      .filter((line) => line.text);

    const fullText = normalizedLines.map((line) => line.text).join("\n");
    const errors = [];

    const typeCandidates = normalizedLines.filter((line) => line.top < 35 || !Number.isFinite(line.top));
    let documentType = "";
    let documentTypeLine = null;
    for (const expected of DOCUMENT_TYPES) {
      const found = typeCandidates.find((line) => comparable(line.text) === comparable(expected));
      if (found) {
        documentType = titleCaseType(expected);
        documentTypeLine = found;
        break;
      }
    }
    if (!documentType) errors.push("Không nhận diện được loại văn bản.");

    const issueDate = parseIssueDate(fullText);
    if (!issueDate) errors.push("Không nhận diện được ngày ban hành.");

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
    const issueDateLine = normalizedLines.find((line) => parseIssueDate(line.text));
    const preferredNumberPages = Array.from(new Set([
      subjectLine?.page,
      documentTypeLine?.page,
      issueDateLine?.page,
      agencyRoot?.page,
      0
    ].filter((page) => Number.isFinite(page))));
    const documentNumber = findDocumentNumber(normalizedLines, preferredNumberPages);
    if (!documentNumber) errors.push("Không nhận diện được số hiệu văn bản.");

    const articleOneIndex = normalizedLines.findIndex((line) => /^Điều\s*1\s*[.:]/iu.test(line.text));
    const articleOneLines = [];
    if (articleOneIndex >= 0) {
      const articlePage = normalizedLines[articleOneIndex].page;
      for (let index = articleOneIndex; index < normalizedLines.length && articleOneLines.length < 8; index += 1) {
        if (normalizedLines[index].page !== articlePage) break;
        if (index > articleOneIndex && /^Điều\s*[2-9]\s*[.:]/iu.test(normalizedLines[index].text)) break;
        articleOneLines.push(normalizedLines[index].text);
      }
    }
    const personPattern = /(?:^|[^\p{L}])(ông|bà)\s*(?:[:\-]\s*)?([^,.;:]+)/iu;
    let articleOneText = clean(articleOneLines[0] || "");
    let personMatch = articleOneText.match(personPattern);
    if (!personMatch && articleOneLines.length > 1) {
      articleOneText = clean(articleOneLines.join(" "));
      personMatch = articleOneText.match(personPattern);
    }
    let person = "";
    if (personMatch) {
      const personName = clean(personMatch[2]
        .replace(/\s+(?:và|hoặc)\s+(?:ông|bà)(?=\s|:|$).*$/iu, "")
        .replace(/\s*\?\s*(?=(?:ông|bà)(?:\s|:|$))/iu, " - "));
      if (personName && !/^(?:và|hoặc|các|những)$/iu.test(personName)) {
        person = clean(`${personMatch[1].toLocaleLowerCase("vi-VN")} ${normalizePersonName(personName)}`);
      }
    }
    let summary = subjectLine
      ? normalizeHonorificSeparators(collectSubjectText(normalizedLines, normalizedLines.indexOf(subjectLine)).replace(/[.:;]+$/u, ""))
      : "";
    if (person && !containsHonorific(summary)) summary = clean(`${summary} ${person}`);
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
    const pages = Array.from(pdfColumn.querySelectorAll?.(".rpv-core__inner-page") || []);
    const pageIndexes = new Map(pages.map((page, index) => [page, index]));
    return Array.from(pdfColumn.querySelectorAll(".rpv-core__text-layer-text[role='presentation']"))
      .map((element, index) => ({
        text: clean(element.textContent),
        top: percentage(element.style.top),
        left: percentage(element.style.left),
        page: pageIndexes.get(element.closest?.(".rpv-core__inner-page")) ?? 0,
        index
      }))
      .filter((line) => line.text)
      .sort((a, b) => (a.page - b.page) || (a.top - b.top) || (a.left - b.left) || (a.index - b.index));
  }

  return { DOCUMENT_TYPES, clean, comparable, parseDocument, parseIssueDate, readPdfTextLayer };
});
