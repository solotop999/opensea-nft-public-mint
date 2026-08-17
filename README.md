# NFT Public Mint Sniper

Công cụ CLI mint NFT public qua SeaDrop trên Ethereum, Base và Robinhood Chain.
Giao dịch được tạo từ dữ liệu on-chain và ký sẵn để gửi đúng thời điểm mở mint.

> Chỉ nên dùng ví phụ và nạp đúng số tiền dự định mint.

## Cài đặt và chạy

Yêu cầu: tự cài đặt [Git](https://git-scm.com/downloads).

Script sẽ tự cài Node.js nếu cần, cài dependency, build, tạo `.env` và chạy chương trình.

### Cài đặt cho Windows
- Mở cmd lên và nhập:

```cmd
git clone https://github.com/solotop999/opensea-nft-public-mint.git && cd opensea-nft-public-mint && install.cmd
```

### Cài đặt cho Linux

```bash
git clone https://github.com/solotop999/opensea-nft-public-mint.git && cd opensea-nft-public-mint && chmod +x install.sh && ./install.sh
```

## Những lần chạy sau

```bash
cd opensea-nft-public-mint
npm start
```

<details>
<summary><strong>Cấu hình RPC riêng</strong></summary>

<br>

Không bắt buộc, nhưng RPC riêng thường nhanh hơn node công khai. Mở `.env` và
điền RPC cho chain cần dùng:

```env
RPC_URL_ETHEREUM=
RPC_URL_BASE=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_URL_ROBINHOOD=
```

Bạn cũng có thể dán URL RPC hoặc Alchemy key trực tiếp khi chương trình hỏi.

> **Không đặt private key hoặc seed phrase trong `.env`.**

</details>

<details>
<summary><strong>Cách sử dụng</strong></summary>

<br>

Chương trình lần lượt hỏi:

1. Private key — nhập được ẩn và chỉ giữ trong RAM.
2. Blockchain và số NFT muốn mint trên mỗi ví.
3. Liên kết OpenSea, slug hoặc địa chỉ contract NFT.
4. RPC, phí gas và thời điểm gửi.
5. Xác nhận cuối cùng trước khi phát giao dịch.

Nếu đợt mint chưa mở, chọn **Chờ đợt mint mở** và giữ máy tính cùng terminal
hoạt động. Không có giao dịch nào được gửi trước khi bạn xác nhận `y`.

</details>

<details>
<summary><strong>Lưu ý kỹ thuật và bảo mật</strong></summary>

<br>

- Hỗ trợ public SeaDrop; không hỗ trợ allowlist `mintSigned()`.
- Chi phí gas thực tế là base fee + tip; max fee chỉ là mức trần.
- Chương trình kiểm tra chain ID, số dư, giới hạn mỗi ví và thời gian mở mint.
- Private key không được ghi xuống ổ đĩa; RPC chỉ nhận raw transaction đã ký.

## Chain hỗ trợ

| Chain | ID | Explorer |
|---|---:|---|
| Ethereum | 1 | etherscan.io |
| Base | 8453 | basescan.org |
| Robinhood Chain | 4663 | robinhoodchain.blockscout.com |

</details>

## Giấy phép

MIT
