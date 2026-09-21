const assert = require("node:assert/strict");
const {
  findHeaderIndexes,
  findIncompleteDocuments,
  findNewDossiers,
  paginationState
} = require("../batch.js");

const dossierHeaders = [
  "STT", "Người tạo", "Mã hồ sơ", "Trạng thái", "Tiêu đề", "Danh sách văn bản"
];
const dossierRows = [
  ["1", "A", "HS-001", "Mới", "Hồ sơ một", "Xem danh sách"],
  ["2", "B", "HS-002", "Chờ duyệt", "Hồ sơ hai", "Xem danh sách"],
  ["3", "C", "HS-003", "MỚI", "Hồ sơ ba", "Xem danh sách"]
];

assert.deepEqual(findHeaderIndexes(dossierHeaders, ["Trạng thái", "Danh sách văn bản"]), {
  "Danh sách văn bản": 5,
  "Trạng thái": 3
});

assert.deepEqual(
  findNewDossiers(dossierHeaders, dossierRows, new Set(["HS-003"])),
  [{ key: "HS-001", rowIndex: 0, title: "Hồ sơ một" }]
);

const documentHeaders = [
  "Người tạo", "STT", "Mã văn bản", "Tên văn bản", "Số và ký hiệu",
  "Trích yếu nội dung", "Ngày ban hành", "Cơ quan ban hành", "Thao tác"
];
const documentRows = [
  ["A", "1", "VB-001", "Tên 1", "", "Trích yếu", "01/01/2020", "Cơ quan", "Sửa"],
  ["A", "2", "VB-002", "Tên 2", "02/QĐ", "", "", "", "Sửa"],
  ["A", "3", "VB-003", "Tên 3", "03/QĐ", "Đủ", "03/01/2020", "Cơ quan", "Sửa"]
];

assert.deepEqual(findIncompleteDocuments(documentHeaders, documentRows, new Set()), [
  { key: "VB-001", rowIndex: 0, missing: ["Số và ký hiệu"] },
  { key: "VB-002", rowIndex: 1, missing: ["Trích yếu nội dung", "Ngày ban hành", "Cơ quan ban hành"] }
]);

assert.deepEqual(paginationState(" 11-20 của 43 "), {
  from: 11,
  to: 20,
  total: 43,
  pageIndex: 1,
  isFirst: false,
  isLast: false
});

assert.deepEqual(paginationState("41-43 của 43"), {
  from: 41,
  to: 43,
  total: 43,
  pageIndex: 4,
  isFirst: false,
  isLast: true
});

console.log("batch.test.js: OK");
