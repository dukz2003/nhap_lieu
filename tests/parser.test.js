const assert = require("node:assert/strict");
const { parseDocument } = require("../parser.js");

// Dữ liệu dưới đây chỉ là fixture để kiểm thử parser. File này không được nạp
// bởi extension; khi chạy thật, content.js đọc các span từ DOM của cột PDF.
const sampleDecisionLines = [
  { text: "UỶ BAN NHÂN DÂN", top: 6.56, left: 13.62 },
  // Mô phỏng OCR đầu trang làm mất dấu "ư".
  { text: "HUYỆN CHU SÊ", top: 8.78, left: 15.32 },
  { text: "Số: 113/QĐ-UBND", top: 12.48, left: 14.81 },
  { text: "Chư Sê, ngày 04 tháng 9 năm 2018", top: 12.94, left: 50.63 },
  { text: "QUYẾT ĐỊNH", top: 18.85, left: 43.47 },
  { text: "Về việc điều động viên chức Sự nghiệp giáo dục", top: 20.34, left: 27.1 },
  { text: "Điều 1. Điều động ông Thái Văn Năm, Giáo viên THCS", top: 50.93, left: 17.03 },
  // Một dòng khác trong cùng DOM có tên địa phương với dấu đầy đủ.
  { text: "Đến nhận công tác tại Trường THCS Nguyễn Du, huyện Chư Sê, kể từ ngày 01/8/2018.", top: 52.95, left: 11.05 }
];

assert.deepEqual(parseDocument(sampleDecisionLines), {
  documentType: "Quyết định",
  issueDate: "04/09/2018",
  issuingAgency: "ỦY BAN NHÂN DÂN HUYỆN CHƯ SÊ",
  documentNumber: "113/QĐ-UBND",
  summary: "Về việc điều động viên chức Sự nghiệp giáo dục ông Thái Văn Năm",
  errors: []
});

const numberWithoutColonLines = sampleDecisionLines.map((line) => ({
  ...line,
  text: line.text.replace("Số: 113/QĐ-UBND", "Số 113/QĐ-UBND")
}));
assert.equal(parseDocument(numberWithoutColonLines).documentNumber, "113/QĐ-UBND");

// Bộ dữ liệu thứ hai cố ý dùng ngày, địa phương, số hiệu và tên người khác để
// bảo đảm parser suy ra dữ liệu đầu vào thay vì trả về giá trị mẫu cố định.
const anotherDecisionLines = [
  { text: "ỦY BAN NHÂN DÂN", top: 6.2, left: 12.1 },
  { text: "HUYỆN ĐẮK ĐOA", top: 8.4, left: 14.5 },
  { text: "Số: 27/QĐ-UBND", top: 12.1, left: 14.2 },
  { text: "Đắk Đoa, ngày 15 tháng 10 năm 2020", top: 12.8, left: 50.1 },
  { text: "QUYẾT ĐỊNH", top: 18.5, left: 43.2 },
  { text: "Về việc bổ nhiệm viên chức quản lý", top: 20.1, left: 28.0 },
  { text: "Điều 1. Bổ nhiệm bà Nguyễn Thị Lan, Hiệu trưởng", top: 49.8, left: 16.7 }
];

assert.deepEqual(parseDocument(anotherDecisionLines), {
  documentType: "Quyết định",
  issueDate: "15/10/2020",
  issuingAgency: "ỦY BAN NHÂN DÂN HUYỆN ĐẮK ĐOA",
  documentNumber: "27/QĐ-UBND",
  summary: "Về việc bổ nhiệm viên chức quản lý bà Nguyễn Thị Lan",
  errors: []
});

const lowercaseOcrNameLines = [
  { text: "UỶ BAN NHÂN DÂN", top: 6.1, left: 13.1 },
  { text: "HUYỆN CHƯ SÊ", top: 8.2, left: 15.1 },
  { text: "Số: 115/QĐ-UBND", top: 12.2, left: 14.1 },
  { text: "Chư Sê, ngày 04 tháng 9 năm 2018", top: 12.7, left: 50.2 },
  { text: "QUYẾT ĐỊNH", top: 18.4, left: 43.1 },
  { text: "Về việc điều động viên chức Sự nghiệp giáo dục", top: 20.2, left: 27.3 },
  { text: "Điều 1. Điều động bà nguyễn Thị Kiên, Giáo viên THCS", top: 50.7, left: 17.0 }
];

assert.equal(
  parseDocument(lowercaseOcrNameLines).summary,
  "Về việc điều động viên chức Sự nghiệp giáo dục bà Nguyễn Thị Kiên"
);

const missingAgencyRootLines = sampleDecisionLines.filter((line) => !/^UỶ BAN NHÂN DÂN$/iu.test(line.text));
assert.equal(
  parseDocument(missingAgencyRootLines).issuingAgency,
  "ỦY BAN NHÂN DÂN HUYỆN CHƯ SÊ"
);
assert.equal(
  parseDocument(missingAgencyRootLines).errors.includes("Không nhận diện được cơ quan ban hành."),
  false
);

const colonPersonLines = sampleDecisionLines.map((line) => ({
  ...line,
  text: line.text
    .replace("Về việc điều động viên chức Sự nghiệp giáo dục", "Về việc nâng bậc lương thường xuyên viên chức")
    .replace("Điều 1. Điều động ông Thái Văn Năm, Giáo viên THCS", "Điều 1. Nâng bậc lương cho bà: vũ thị Lụa")
}));
assert.equal(
  parseDocument(colonPersonLines).summary,
  "Về việc nâng bậc lương thường xuyên viên chức bà Vũ Thị Lụa"
);

const corruptedDayLines = sampleDecisionLines.map((line) => ({
  ...line,
  text: line.text.replace("ngày 04 tháng 9", "ngày 0y tháng 9")
}));
assert.equal(parseDocument(corruptedDayLines).issueDate, "");
assert.equal(parseDocument(corruptedDayLines).errors.includes("Không nhận diện được ngày ban hành."), true);

const corruptedMonthLines = sampleDecisionLines.map((line) => ({
  ...line,
  text: line.text.replace("ngày 04 tháng 9", "ngày 04 tháng g")
}));
assert.equal(parseDocument(corruptedMonthLines).issueDate, "");
assert.equal(parseDocument(corruptedMonthLines).errors.includes("Không nhận diện được ngày ban hành."), true);

console.log("parser.test.js: OK");
