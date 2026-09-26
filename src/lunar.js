// Thuật toán Lịch Âm Việt Nam chuẩn thiên văn - Hồ Ngọc Đức
const CAN = ["Giáp", "Ất", "Bính", "Đinh", "Mậu", "Kỷ", "Canh", "Tân", "Nhâm", "Quý"];
const CHI = ["Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ", "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi"];

const TIET_KHI = [
  "Xuân phân", "Thanh minh", "Cốc vũ", "Lập hạ", "Tiểu mãn", "Mang chủng",
  "Hạ chí", "Tiểu thử", "Đại thử", "Lập thu", "Xử thử", "Bạch lộ",
  "Thu phân", "Hàn lộ", "Sương giáng", "Lập đông", "Tiểu tuyết", "Đại tuyết",
  "Đông chí", "Tiểu hàn", "Đại hàn", "Lập xuân", "Vũ thủy", "Kinh trập"
];

const WEEKDAYS = ["CHỦ NHẬT", "THỨ HAI", "THỨ BA", "THỨ TƯ", "THỨ NĂM", "THỨ SÁU", "THỨ BẢY"];

function jdFromDate(dd, mm, yy) {
  let a = Math.floor((14 - mm) / 12);
  let y = yy + 4800 - a;
  let m = mm + 12 * a - 3;
  let jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  return jd;
}

function getNewMoonDay(k, timeZone) {
  let T = k / 1236.85;
  let T2 = T * T;
  let T3 = T2 * T;
  let dr = Math.PI / 180;
  let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  let M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  let Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  let F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 -= 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(2 * dr * Mpr);
  C1 -= 0.0004 * Math.sin(3 * dr * Mpr);
  C1 += 0.0104 * Math.sin(2 * dr * F) - 0.0051 * Math.sin((M + Mpr) * dr);
  C1 -= 0.0074 * Math.sin((M - Mpr) * dr) + 0.0004 * Math.sin((2 * F + M) * dr);
  C1 -= 0.0004 * Math.sin((2 * F - M) * dr) - 0.0006 * Math.sin((2 * F + Mpr) * dr);
  C1 += 0.0010 * Math.sin((2 * F - Mpr) * dr) + 0.0005 * Math.sin((2 * Mpr + M) * dr);
  let JdNew = Jd1 + C1;
  return Math.floor(JdNew + 0.5 + timeZone / 24);
}

function getSunLongitude(jdn, timeZone) {
  let T = (jdn - 2451545.0 + 0.5 - timeZone / 24) / 36525;
  let dr = Math.PI / 180;
  let L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  let M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  let C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M * dr);
  C += (0.019993 - 0.000101 * T) * Math.sin(2 * M * dr) + 0.000289 * Math.sin(3 * M * dr);
  let theta = L0 + C;
  theta = theta * dr;
  theta = theta - Math.PI * 2 * Math.floor(theta / (Math.PI * 2));
  return Math.floor((theta / Math.PI) * 6);
}

function getLunarMonth11(yy, timeZone) {
  let off = jdFromDate(31, 12, yy) - 2415021;
  let k = Math.floor(off / 29.530588853);
  let nm = getNewMoonDay(k, timeZone);
  let sunLong = getSunLongitude(nm, timeZone);
  if (sunLong >= 9) {
    nm = getNewMoonDay(k - 1, timeZone);
  }
  return nm;
}

export function convertSolar2Lunar(dd, mm, yy, timeZone = 7) {
  let dayNumber = jdFromDate(dd, mm, yy);
  let k = Math.floor((dayNumber - 2415021.0769986) / 29.530588853);
  let monthStart = getNewMoonDay(k + 1, timeZone);
  if (monthStart > dayNumber) {
    monthStart = getNewMoonDay(k, timeZone);
  }
  let a11 = getLunarMonth11(yy, timeZone);
  let b11 = a11;
  let lunarYear;
  if (a11 >= monthStart) {
    lunarYear = yy;
    a11 = getLunarMonth11(yy - 1, timeZone);
  } else {
    lunarYear = yy + 1;
    b11 = getLunarMonth11(yy + 1, timeZone);
  }
  let lunarDay = dayNumber - monthStart + 1;
  let diff = Math.floor((monthStart - a11) / 29);
  let lunarLeap = 0;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    let leapMonthDiff = getLeapMonthOffset(a11, timeZone);
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) {
        lunarLeap = 1;
      }
    }
  }
  if (lunarMonth > 12) {
    lunarMonth = lunarMonth - 12;
  }
  if (lunarMonth >= 11 && diff < 4) {
    lunarYear -= 1;
  }

  // Can Chi calculations
  let canYear = CAN[(lunarYear + 6) % 10];
  let chiYear = CHI[(lunarYear + 8) % 12];
  let canChiYear = `${canYear} ${chiYear}`;

  let canDay = CAN[(dayNumber + 9) % 10];
  let chiDay = CHI[(dayNumber + 1) % 12];
  let canChiDay = `${canDay} ${chiDay}`;

  // Can Chi Month
  let canMonth = CAN[(lunarYear * 12 + lunarMonth + 3) % 10];
  let chiMonth = CHI[(lunarMonth + 1) % 12];
  let canChiMonth = `${canMonth} ${chiMonth}`;

  // Can Chi Hour (for current hour)
  let now = new Date();
  let currentHour = now.getHours();
  let chiHourIndex = Math.floor((currentHour + 1) / 2) % 12;
  let chiHour = CHI[chiHourIndex];
  let canDayIndex = (dayNumber + 9) % 10;
  let canHourIndex = (canDayIndex * 2 + chiHourIndex) % 10;
  let canHour = CAN[canHourIndex];
  let canChiHour = `${canHour} ${chiHour}`;

  // Tiết khí
  let sunLong = getSunLongitude(dayNumber, timeZone);
  let tietKhiName = TIET_KHI[sunLong] || "Hàn lộ";

  return {
    lunarDay,
    lunarMonth,
    lunarYear,
    lunarLeap,
    canChiYear,
    canChiMonth,
    canChiDay,
    canChiHour,
    tietKhi: tietKhiName
  };
}

function getLeapMonthOffset(a11, timeZone) {
  let k = Math.floor((a11 - 2415021.0769986) / 29.530588853);
  let last = 0;
  let i = 1;
  let arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  do {
    last = arc;
    i++;
    arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  } while (arc !== last && i < 14);
  return i - 1;
}

export function getFullDateInfo() {
  let now = new Date();
  let dd = now.getDate();
  let mm = now.getMonth() + 1;
  let yy = now.getFullYear();
  let dayOfWeek = WEEKDAYS[now.getDay()];

  let lunar = convertSolar2Lunar(dd, mm, yy, 7);

  return {
    solar: {
      day: dd,
      month: mm,
      year: yy,
      weekday: dayOfWeek,
      dateFormatted: `${dd.toString().padStart(2, '0')}/${mm.toString().padStart(2, '0')}/${yy}`
    },
    lunar
  };
}
