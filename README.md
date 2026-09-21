# NextForm - Tự động điền metadata

Tiện ích Chrome/Edge đọc lớp chữ của PDF trên trang `sdoc.nextform.vn/nhap-lieu` và chuẩn bị 5 trường:

- Loại văn bản
- Ngày ban hành
- Tên cơ quan/tổ chức/cá nhân ban hành
- Số hiệu văn bản
- Trích yếu, ghép thêm tên người ở Điều 1

Tiện ích không chứa dữ liệu cố định của văn bản mẫu. Mỗi lần bấm **Đọc lại PDF**, nó lấy các phần tử DOM `.rpv-core__text-layer-text` ngay trong cột PDF bên trái, phân tích nội dung hiện tại rồi mới điền sang biểu mẫu bên phải. Dữ liệu trong `tests/parser.test.js` chỉ là fixture kiểm thử và không được trình duyệt nạp khi tiện ích hoạt động.

## Cài đặt

1. Mở `chrome://extensions` hoặc `edge://extensions`.
2. Bật **Chế độ dành cho nhà phát triển**.
3. Chọn **Tải tiện ích đã giải nén / Load unpacked**.
4. Chọn thư mục chứa file `manifest.json` này.
5. Tải lại trang nhập liệu NextForm.

## Sử dụng

1. Mở cửa sổ cập nhật văn bản và đợi PDF hiển thị xong.
2. Bảng **Tự động điền metadata** xuất hiện ở góc phải dưới.
3. Kiểm tra hoặc sửa dữ liệu trong bảng xem trước.
4. Chọn **Điền biểu mẫu** để chỉ điền, không lưu.
5. Chọn **Điền và lưu** nếu muốn điền rồi lưu. Tiện ích luôn hỏi xác nhận ngay trước khi bấm nút **Lưu thông tin**.

Nếu PDF vừa đổi nhưng bảng vẫn còn dữ liệu cũ, bấm **Đọc lại PDF**.

## Xử lý hàng loạt

Tại trang `https://sdoc.nextform.vn/nhap-lieu?PhongId=...`, bảng tiện ích có thêm nút **Chạy từ đầu**. Khi bạn xác nhận, tiện ích sẽ:

1. Đưa danh sách hồ sơ về trang đầu và duyệt tới trang cuối.
2. Chỉ mở các hồ sơ có cột **Trạng thái** bằng `Mới`.
3. Trong từng hồ sơ, duyệt toàn bộ các trang danh sách văn bản.
4. Chỉ mở văn bản nếu thiếu ít nhất một trong bốn cột: **Số và ký hiệu**, **Trích yếu nội dung**, **Ngày ban hành**, **Cơ quan ban hành**.
5. Đọc DOM của PDF, điền metadata, bấm **Lưu thông tin** và đọc popup kết quả.
6. Nếu lưu thất bại hoặc parser thiếu dữ liệu, ghi lỗi vào nhật ký, đóng cửa sổ sửa và tiếp tục văn bản kế tiếp.

Nếu các văn bản trong cùng một trang có chung ngày ban hành nhưng một số PDF không nhận diện được ngày, chọn ngày trong ô lịch **Ngày mẫu cho cả trang** trước khi bấm **Chạy từ đầu**. Ngày mẫu chỉ được dùng khi trường **Ngày ban hành** đang trống; ngày đọc được từ PDF vẫn được ưu tiên. Khi mở một văn bản lỗi và bấm **Quét thủ công**, ngày mẫu cũng được đưa vào bảng xem trước để bạn kiểm tra trước khi **Submit và lưu**.

Nút **Dừng** ngăn tiện ích mở hoặc lưu văn bản tiếp theo. Trạng thái chạy được lưu trong `sessionStorage` của tab, vì vậy tiện ích có thể tiếp tục sau khi trang điều hướng hoặc tải lại. Nếu trang tải lại ngay sau khi đã bấm lưu nhưng chưa đọc được popup, văn bản đó được đánh dấu *kết quả chưa xác định* và không tự lưu lần hai để tránh trùng dữ liệu.

> Chế độ hàng loạt thực sự ghi dữ liệu lên hệ thống. Tiện ích luôn yêu cầu xác nhận rõ ràng trước khi bắt đầu.

## Quy tắc nhận dạng hiện tại

- Loại văn bản: tìm tiêu đề trùng một loại trong danh sách của NextForm.
- Ngày ban hành: nhận dạng mẫu `ngày DD tháng MM năm YYYY`.
- Cơ quan ban hành: ghép dòng `ỦY BAN NHÂN DÂN` với dòng địa phương ở phần đầu văn bản.
- Số hiệu: lấy nội dung sau `Số:`.
- Trích yếu: lấy dòng bắt đầu bằng `Về việc`, rồi ghép `ông/bà + họ tên` từ Điều 1.

## Kiểm thử

```powershell
npm test
```
