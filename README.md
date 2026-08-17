# NFT Public Mint Sniper

Công cụ dòng lệnh dùng để săn các đợt mint NFT **public** qua SeaDrop của OpenSea
trên Ethereum, Base và Robinhood Chain.

Hỗ trợ nhiều ví: có thể dán nhiều private key và gửi giao dịch song song.

---

## Cài đặt bằng script

Script tự kiểm tra/cài Node.js, cài dependency đúng theo `package-lock.json`,
build chương trình và tạo file `.env`. Chỉ cần kết nối Internet trong lúc cài.

### Windows

1. Tải source và giải nén.
2. Mở thư mục vừa giải nén, bấm vào thanh địa chỉ của File Explorer, nhập
   `powershell` rồi nhấn Enter.
3. Chạy đúng một lệnh:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### Linux

Mở terminal trong thư mục source rồi chạy:

```bash
chmod +x install.sh
./install.sh
```

Khi thấy dòng `Installation complete. Run: npm start`, quá trình cài đặt đã
hoàn tất. Script cài đặt không hỏi hoặc lưu private key.

<details>
<summary>Nếu script báo lỗi</summary>

- Kiểm tra terminal đang mở đúng thư mục có `install.ps1` hoặc `install.sh`.
- Windows cần `winget` nếu máy chưa có Node.js 18 trở lên.
- Linux hỗ trợ `apt`, `dnf` hoặc `pacman`; có thể yêu cầu mật khẩu `sudo`.
- Nếu vừa cài Node.js trên Windows nhưng chưa nhận lệnh, mở PowerShell mới rồi
  chạy lại script.

</details>

## Cấu hình RPC (không bắt buộc nhưng nên dùng)

Script đã tự tạo `.env`. Mở file này và thêm URL RPC riêng cho chain muốn mint,
ví dụ:

```env
RPC_URL_BASE=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
```

RPC riêng như [Alchemy](https://alchemy.com) giúp tăng đáng kể cơ hội trong một
đợt mint cạnh tranh. Bạn cũng có thể dán RPC trực tiếp khi chương trình hỏi.
Không có `.env`, công cụ vẫn chạy bằng node công khai nhưng có thể chậm hơn.

> **Tuyệt đối không đặt private key trong `.env`.** Private key chỉ được dán vào
> CLI khi chạy, giữ trong RAM trong phiên đó và không được ghi xuống ổ đĩa.

## Chạy chương trình

```bash
npm start
```

Trình hướng dẫn sẽ lần lượt hỏi:

| Bước | Nội dung |
|---|---|
| **1. Private key** | Dán mỗi dòng một key; nội dung nhập được ẩn. Để trống một dòng để hoàn tất. Mỗi key được xác nhận bằng địa chỉ ví. |
| **2. Blockchain** | Ethereum, Base hoặc Robinhood Chain. |
| **3. Số lượng** | Số NFT muốn mint **trên mỗi ví**. |
| **4. NFT mục tiêu** | Liên kết bộ sưu tập hoặc NFT trên OpenSea, slug hay địa chỉ contract `0x`. Địa chỉ contract và liên kết NFT không cần API key; slug cần được tra cứu. |
| **5. RPC** | Dán URL đầy đủ hoặc chỉ Alchemy key để tự tạo URL. Để trống sẽ dùng `.env` hoặc node công khai. |
| **6. Gas** | Mức phí tối đa và phí ưu tiên. Base fee hiện tại được hiển thị ngay trước câu hỏi. |
| **7. Thời điểm** | Chờ đợt mint mở hoặc gửi ngay nếu đợt mint đang hoạt động. |

Sau đó chương trình hiển thị bản tóm tắt và hỏi `Gửi giao dịch?`.
**Không có gì được gửi cho đến khi bạn nhập `y`.**

## Bước 4 — Đặt lịch và để chương trình tự chạy

Nếu đợt mint mở sau, chọn **“Chờ đợt mint mở”**. Chương trình ký sẵn mọi giao
dịch, chờ và gửi đúng thời điểm bắt đầu. Câu hỏi xác nhận xuất hiện trước khi
chờ nên không cần xác nhận lần nữa tại thời điểm mint.

Nếu để chương trình chạy mà không giám sát:

- **Không để máy tính ngủ.** Khi máy ngủ, tiến trình và bộ đếm ngược sẽ dừng.
- **Giữ cửa sổ terminal mở.** Đóng terminal sẽ kết thúc chương trình.

---

## Hiểu về phí gas

| Thuật ngữ | Ý nghĩa | Người quyết định |
|---|---|---|
| **Base fee** | Mức phí của mạng, bị đốt | Blockchain |
| **Priority fee** (tip) | Phí trả thêm cho nhà sản xuất block | Bạn |
| **Max fee** | Mức phí trần bạn chấp nhận | Bạn |

**Chi phí thực tế là base fee + tip.** Max fee chỉ là mức trần. Ví dụ base fee
là 0.006 gwei và tip là 0.05 gwei thì bạn trả 0.056 gwei, bất kể mức trần là
2 hay 200 gwei.

Node chỉ nhận giao dịch nếu ví có ít nhất `gasLimit × maxFee + giá mint`. Vì vậy
mức trần quá cao có thể khiến ví ít tiền bị từ chối dù chi phí thực tế thấp.
Công cụ kiểm tra điều này trước khi gửi và cho biết mức max fee cao nhất mà số
dư có thể đáp ứng.

Một giao dịch SeaDrop mint số lượng 1 thường dùng khoảng **135.000 gas**.

## Các lỗi được kiểm tra trước khi gửi

- **Max fee thấp hơn base fee** — mọi node sẽ từ chối và chương trình không cho
  nhập mức này.
- **Tip cao hơn max fee** — không hợp lệ theo EIP-1559.
- **Ví không đủ số dư tạm giữ** — chương trình không gửi và thông báo mức phí
  tối đa mà ví có thể đáp ứng.
- **Gửi trước khi đợt mint mở** — SeaDrop sẽ revert với `NotActive` và vẫn tốn
  gas; tùy chọn gửi ngay không xuất hiện nếu đợt mint chưa mở.
- **Sai mạng** — chain ID của từng RPC được kiểm tra; RPC sai chain sẽ bị loại.
- **Số lượng vượt giới hạn mỗi ví** — chương trình cảnh báo trước khi gửi.

Nếu tất cả endpoint đều từ chối giao dịch, chương trình sẽ thông báo ngay thay
vì chờ một receipt không bao giờ xuất hiện.

## Blockchain được hỗ trợ

| Blockchain | Chain ID | Trình khám phá block |
|---|---:|---|
| Ethereum | 1 | etherscan.io |
| Base | 8453 | basescan.org |
| Robinhood Chain | 4663 | robinhoodchain.blockscout.com |

Để thêm chain khác, thêm một mục vào [`src/chains.ts`](src/chains.ts); không cần
sửa những phần khác.

## Bảo mật

- Private key được dán khi chạy, giữ trong RAM và **không bao giờ được ghi xuống
  ổ đĩa hoặc truyền đi**; chỉ raw transaction đã ký cục bộ được gửi tới RPC.
- `.env`, `wallets/` và `*.key` đều được Git bỏ qua.
- Chỉ nên sử dụng ví phụ, nạp đúng số tiền dự định chi tiêu.
- Có thể đọc [`src/local-mint.ts`](src/local-mint.ts) để kiểm tra chính xác dữ
  liệu được ký và gửi.

## Mint allowlist / FCFS

Công cụ này không hỗ trợ mint allowlist. Giai đoạn allowlist sử dụng hàm
`mintSigned()`, cần chữ ký do OpenSea tạo riêng cho từng ví và vì vậy cần phiên
OpenSea đã xác thực. Không thể tạo chữ ký đó chỉ từ dữ liệu on-chain, trong khi
đây là nguyên tắc hoạt động của công cụ này.

## Giấy phép

MIT
