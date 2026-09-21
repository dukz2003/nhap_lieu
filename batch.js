(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NextFormBatch = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clean(value) {
    return String(value || "")
      .replace(/arrow_(?:upward|downward)/giu, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function comparable(value) {
    return clean(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLocaleUpperCase("vi-VN");
  }

  function findHeaderIndexes(headers, requested) {
    const result = {};
    for (const name of requested) {
      result[name] = headers.findIndex((header) => comparable(header) === comparable(name));
    }
    return result;
  }

  function cell(row, index) {
    return index >= 0 ? clean(row[index]) : "";
  }

  function findNewDossiers(headers, rows, processedKeys) {
    const indexes = findHeaderIndexes(headers, [
      "STT", "Mã hồ sơ", "Trạng thái", "Tiêu đề", "Danh sách văn bản"
    ]);
    if (indexes["Trạng thái"] < 0 || indexes["Danh sách văn bản"] < 0) return [];

    return rows.flatMap((row, rowIndex) => {
      if (comparable(cell(row, indexes["Trạng thái"])) !== comparable("Mới")) return [];
      const key = cell(row, indexes["Mã hồ sơ"]) || cell(row, indexes.STT) || `row-${rowIndex}`;
      if (processedKeys.has(key)) return [];
      return [{
        key,
        rowIndex,
        title: cell(row, indexes["Tiêu đề"]) || key
      }];
    });
  }

  function findIncompleteDocuments(headers, rows, processedKeys) {
    const required = ["Số và ký hiệu", "Trích yếu nội dung", "Ngày ban hành", "Cơ quan ban hành"];
    const indexes = findHeaderIndexes(headers, ["STT", "Mã văn bản", "Thao tác", ...required]);
    if (required.some((name) => indexes[name] < 0) || indexes["Thao tác"] < 0) return [];

    return rows.flatMap((row, rowIndex) => {
      const key = cell(row, indexes["Mã văn bản"]) || cell(row, indexes.STT) || `row-${rowIndex}`;
      if (key === `row-${rowIndex}`) return [];
      if (processedKeys.has(key)) return [];
      const missing = required.filter((name) => !cell(row, indexes[name]));
      return missing.length ? [{ key, rowIndex, missing }] : [];
    });
  }

  function hasIdentifiedRows(headers, rows) {
    const indexes = findHeaderIndexes(headers, ["STT", "Mã văn bản"]);
    return rows.some((row) =>
      Boolean(cell(row, indexes["Mã văn bản"]) || cell(row, indexes.STT))
    );
  }

  function paginationState(text, pageSize = 10) {
    const match = clean(text).match(/(\d+)\s*-\s*(\d+)\s+của\s+(\d+)/iu);
    if (!match) return null;
    const from = Number(match[1]);
    const to = Number(match[2]);
    const total = Number(match[3]);
    const safePageSize = Math.max(1, Number(pageSize) || 10);
    return {
      from,
      to,
      total,
      pageIndex: Math.floor((from - 1) / safePageSize),
      isFirst: from <= 1,
      isLast: to >= total
    };
  }

  function normalizeDateTemplate(value) {
    const raw = clean(value).replace(/[.-]/g, "/");
    let match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u);
    if (!match) {
      const iso = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/u);
      if (iso) match = [iso[0], iso[3], iso[2], iso[1]];
    }
    if (!match) return "";

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  }

  function applyDateTemplate(metadata, template) {
    const normalized = normalizeDateTemplate(template);
    if (!normalized || metadata?.issueDate) return metadata;
    return {
      ...metadata,
      issueDate: normalized,
      errors: (metadata.errors || []).filter((error) => !/ngày ban hành/iu.test(error))
    };
  }

  function mergeRuntimeState(persisted, incoming, allowRestart = false) {
    if (!persisted || allowRestart) return incoming;

    if (persisted.runId && incoming.runId && persisted.runId !== incoming.runId) {
      return persisted;
    }

    if (persisted.active === false && incoming.active === true) {
      return {
        ...incoming,
        active: false,
        phase: persisted.phase,
        logs: persisted.logs || incoming.logs
      };
    }

    return incoming;
  }

  return {
    clean,
    comparable,
    findHeaderIndexes,
    findIncompleteDocuments,
    findNewDossiers,
    hasIdentifiedRows,
    applyDateTemplate,
    mergeRuntimeState,
    normalizeDateTemplate,
    paginationState
  };
});
