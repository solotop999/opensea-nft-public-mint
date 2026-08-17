// Mint times get announced in IST, so every command prints them that way.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function toIST(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDate();
  const month = ist.getUTCMonth() + 1;
  const year = ist.getUTCFullYear();
  const hours = ist.getUTCHours();
  const minutes = ist.getUTCMinutes().toString().padStart(2, "0");
  const seconds = ist.getUTCSeconds().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  return `${day}/${month}/${year}, ${h12}:${minutes}:${seconds} ${ampm}`;
}

// "21:05" → today at 21:05 IST, expressed as a UTC Date.
export function istTimeToDate(hhmm: string): Date {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) throw new Error(`Thời gian "${hhmm}" không hợp lệ — dùng HH:MM (24 giờ, IST)`);
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh > 23 || mm > 59) throw new Error(`Thời gian "${hhmm}" không hợp lệ — dùng HH:MM (24 giờ, IST)`);

  const todayIST = new Date(Date.now() + IST_OFFSET_MS);
  todayIST.setUTCHours(hh, mm, 0, 0);
  return new Date(todayIST.getTime() - IST_OFFSET_MS);
}
