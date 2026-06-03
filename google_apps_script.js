/**
 * Этот скрипт разворачивается в Google Apps Script (GAS)
 * Инструкции:
 * 1. Создайте Google Таблицу
 * 2. Перейдите: Расширения -> Apps Script
 * 3. Вставьте этот код
 * 4. Нажмите СУПЕРВАЖНО: Начать развертывание -> Новое развертывание -> Веб-приложение (доступ: Все)
 */

const SHEET_PARTICIPANTS = "Участники";
const SHEET_WINNERS = "Победители";
const SHEET_LOGS = "Логи";
const SHEET_SETTINGS = "Настройки";

// Данные администратора рекомендуется хранить в Script Properties (PropertiesService)
// Для первоначальной установки можно задать их здесь или в настройках скрипта.
// PropertiesService.getScriptProperties().setProperty("ADMIN_LOGIN", "admin");
// PropertiesService.getScriptProperties().setProperty("ADMIN_PASSWORD", "password123");

// Функция для первоначальной генерации листов, если их нет
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET_PARTICIPANTS)) {
    let s = ss.insertSheet(SHEET_PARTICIPANTS);
    s.appendRow([
      "ФД",
      "Время чека",
      "Сумма",
      "ФИО",
      "Телефон",
      "Дата регистрации",
      "Статус",
    ]);
  }
  if (!ss.getSheetByName(SHEET_WINNERS)) {
    let s = ss.insertSheet(SHEET_WINNERS);
    s.appendRow(["ФД", "ФИО", "Телефон", "Приз", "Дата розыгрыша"]);
  }
  if (!ss.getSheetByName(SHEET_LOGS)) {
    let s = ss.insertSheet(SHEET_LOGS);
    s.appendRow(["Дата", "Действие", "Чек", "Админ"]);
  }
  if (!ss.getSheetByName(SHEET_SETTINGS)) {
    let s = ss.insertSheet(SHEET_SETTINGS);
    s.appendRow(["Ключ", "Значение"]);
    s.appendRow(["startDate", "2026-06-01T00:00:00"]);
    s.appendRow(["endDate", "2026-06-30T23:59:00"]);
    s.appendRow(["drawDate", "2026-07-02T12:00:00"]);
    s.appendRow(["registrationEnabled", "true"]);
    s.appendRow(["winnersPublished", "false"]);
  }
}

// Вспомогательная функция для чтения настроек
function getSettings(ss) {
  const sheet = ss.getSheetByName(SHEET_SETTINGS);
  const settings = {
    startDate: "",
    endDate: "",
    drawDate: "",
    registrationEnabled: "true",
    winnersPublished: "false",
  };
  if (!sheet) return settings;
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][0]).trim();
    const val = String(values[i][1]).trim();
    if (key) {
      settings[key] = val;
    }
  }
  return settings;
}

function parsePrize(val) {
  if (typeof val === "object" && val instanceof Date) {
    // Google Sheets converts numbers like 1-10 to early 1900 dates if column gets formatted as date
    // Dec 30 1899 is 0 in Google Sheets.
    // 1900-01-08 is roughly 9.
    // A simple way to recover small integers is to calculate days since Dec 30 1899
    const baseDate = new Date(Date.UTC(1899, 11, 30)); // Dec 30 1899
    const msPerDay = 24 * 60 * 60 * 1000;
    const diff = Math.round((val.getTime() - baseDate.getTime()) / msPerDay);
    if (diff >= 1 && diff <= 10) return diff;
    
    // Just in case timezone shifted it, get Date component
    if (val.getFullYear() === 1899 || val.getFullYear() === 1900) {
      return val.getDate() + (val.getMonth() === 11 ? 1 : (val.getDate() >= 8 ? 1 : 0)); // very rough fallback, it's better to just extract the day and guess 1-10.
    }
  }
  
  let parsed = parseInt(String(val).replace(/^'/, ""), 10);
  return isNaN(parsed) ? val : parsed;
}

function fetchWinnersData(ss) {
  const sheet = ss.getSheetByName(SHEET_WINNERS);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const winners = [];

  // Columns: ФД (0), Имя (1), Телефон (2), Приз (3), Дата розыгрыша (4)
  for (let i = 1; i < data.length; i++) {
    let rawPrize = data[i][3];
    winners.push({
      receipt: cleanReceipt(data[i][0]),
      name: data[i][1],
      phone: cleanReceipt(data[i][2]),
      prize: parsePrize(rawPrize),
      date: data[i][4],
    });
  }
  return winners;
}

function getWinnersList(ss, token) {
  const settings = getSettings(ss);
  const cache = CacheService.getScriptCache();

  // Check if authenticated
  const isAdmin = token && cache.get("auth_" + token);

  if (!isAdmin && settings.winnersPublished !== "true") {
    return [];
  }

  return fetchWinnersData(ss);
}

// Принимает GET-запросы
function doGet(e) {
  const action = e.parameter.action;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (action === "getSettings") {
    const settingsObj = getSettings(ss);
    return ContentService.createTextOutput(
      JSON.stringify({ success: true, settings: settingsObj }),
    ).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "winners") {
    const winners = getWinnersList(ss, e.parameter.token);
    return ContentService.createTextOutput(
      JSON.stringify({ success: true, winners: winners }),
    ).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "participants") {
    const token = e.parameter.token;
    const cache = CacheService.getScriptCache();
    if (!token || !cache.get("auth_" + token)) {
      return ContentService.createTextOutput(
        JSON.stringify({ success: false, message: "Необходима авторизация" }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = ss.getSheetByName(SHEET_PARTICIPANTS);
    if (!sheet)
      return ContentService.createTextOutput(
        JSON.stringify({ success: true, participants: [] }),
      ).setMimeType(ContentService.MimeType.JSON);

    const data = sheet.getDataRange().getValues();
    const participants = [];

    // ФД (0), Время чека (1), Сумма (2), Имя (3), Телефон (4), Дата регистрации (5), Статус (6)
    for (let i = 1; i < data.length; i++) {
      participants.push({
        receipt: data[i][0],
        checkTime: data[i][1],
        amount: data[i][2],
        name: data[i][3],
        phone: data[i][4],
        date: data[i][5],
        won: data[i][6] === "Победитель",
      });
    }

    return ContentService.createTextOutput(
      JSON.stringify({ success: true, participants: participants }),
    ).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput("Google Script is Works!");
}

// Принимает POST-запросы
function doPost(e) {
  try {
    let data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (err) {
      data = JSON.parse(e.parameter.data || "{}");
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (data.action === "winners") {
      const winners = getWinnersList(ss, data.token);
      return ContentService.createTextOutput(
        JSON.stringify({ success: true, winners: winners }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // Проверка логина и пароля администратора
    if (data.action === "login") {
      const cache = CacheService.getScriptCache();
      const loginKey = "login_attempts_" + String(data.login || "unknown");
      const attempts = parseInt(cache.get(loginKey) || "0", 10);

      if (attempts >= 5) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message: "Слишком много попыток входа. Попробуйте через 15 минут.",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      const p = PropertiesService.getScriptProperties();
      const adminLogin = p.getProperty("ADMIN_LOGIN");
      const adminPass = p.getProperty("ADMIN_PASSWORD");

      if (!adminLogin || !adminPass) {
        throw new Error(
          "ADMIN_LOGIN или ADMIN_PASSWORD не настроены в Script Properties",
        );
      }

      if (data.login === adminLogin && data.password === adminPass) {
        const token = Utilities.getUuid();
        // Сохраняем имя администратора в кэш на 6 часов (максимум для CacheService - 21600 секунд)
        cache.put("auth_" + token, String(data.login), 21600);
        cache.remove(loginKey);
        return ContentService.createTextOutput(
          JSON.stringify({
            success: true,
            message: "Авторизация успешна",
            token: token,
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      } else {
        cache.put(loginKey, String(attempts + 1), 900); // 15 минут
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message: "Неверный логин или пароль",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (data.action === "participants") {
      const token = data.token;
      const cache = CacheService.getScriptCache();
      if (!token || !cache.get("auth_" + token)) {
        return ContentService.createTextOutput(
          JSON.stringify({ success: false, message: "Необходима авторизация" }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      const sheet = ss.getSheetByName(SHEET_PARTICIPANTS);
      if (!sheet)
        return ContentService.createTextOutput(
          JSON.stringify({ success: true, participants: [] }),
        ).setMimeType(ContentService.MimeType.JSON);

      const valData = sheet.getDataRange().getValues();
      const participantsList = [];

      // ФД (0), Время чека (1), Сумма (2), Имя (3), Телефон (4), Дата регистрации (5), Статус (6)
      for (let i = 1; i < valData.length; i++) {
        participantsList.push({
          receipt: valData[i][0],
          checkTime: valData[i][1],
          amount: valData[i][2],
          name: valData[i][3],
          phone: valData[i][4],
          date: valData[i][5],
          won: valData[i][6] === "Победитель",
        });
      }

      return ContentService.createTextOutput(
        JSON.stringify({ success: true, participants: participantsList }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === "register") {
      // Проверка периода регистрации по динамическим настройкам в таблице
      const settings = getSettings(ss);
      if (
        settings.registrationEnabled === "false" ||
        settings.registrationEnabled === false
      ) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message: "Регистрация временно приостановлена администратором",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      const now = new Date();
      if (settings.startDate) {
        const start = new Date(settings.startDate);
        if (now < start) {
          return ContentService.createTextOutput(
            JSON.stringify({
              success: false,
              message: "Регистрация еще не началась",
            }),
          ).setMimeType(ContentService.MimeType.JSON);
        }
      }

      if (settings.endDate) {
        const end = new Date(settings.endDate);
        if (now > end) {
          return ContentService.createTextOutput(
            JSON.stringify({
              success: false,
              message: "Регистрация завершена",
            }),
          ).setMimeType(ContentService.MimeType.JSON);
        }
      }

      const checkTime = String(data.checkTime || "").trim();
      const amount = parseFloat(data.amount);

      if (
        !data.receipt ||
        !data.name ||
        !data.phone ||
        !checkTime ||
        isNaN(amount)
      ) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message:
              "Не заполнены все обязательные поля (ФД, ФИО, Телефон, Время чека, Сумма)",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      // Проверка суммы покупки
      if (amount < 1500) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message:
              "Минимальная сумма покупки для участия в акции — 1500 рублей",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      // Проверка даты чека
      const checkDate = new Date(checkTime);
      const minStart = settings.startDate ? new Date(settings.startDate) : new Date(0);
      const maxEnd = settings.endDate ? new Date(settings.endDate) : new Date(8640000000000000);
      if (
        isNaN(checkDate.getTime()) ||
        checkDate < minStart ||
        checkDate > maxEnd
      ) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message:
              "Разрешены только чеки в период акции",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      const name = String(data.name).trim();
      // Ограничение длины ФИО до 100 символов
      if (name.length < 2 || name.length > 100) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message: "ФИО должно быть длиной от 2 до 100 символов",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      const receipt = String(data.receipt).trim();

      // Фискальный код: требуем начало 000081 и длину ровно 12 цифр
      if (!receipt.startsWith("000081") || !/^\d{12}$/.test(receipt)) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message: "Неправильный код чека",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      // Нормализация номера телефона (удаляем +373 и 373, а также любые не-цифры)
      const phoneInput = String(data.phone).trim();
      let normalizedPhone = phoneInput.replace(/\D/g, "");
      if (normalizedPhone.indexOf("373") === 0) {
        normalizedPhone = normalizedPhone.substring(3);
      }

      // Проверка формата телефона: ровно 8 цифр
      if (!/^\d{8}$/.test(normalizedPhone)) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message:
              "Некорректный номер телефона (должен состоять ровно из 8 цифр)",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      const lock = LockService.getScriptLock();
      try {
        // Блокируем доступ на 30 секунд для предотвращения гонок и дубликатов
        lock.waitLock(30000);
      } catch (e) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message:
              "Сервер перегружен запросами. Пожалуйста, попробуйте еще раз.",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      try {
        const sheet = ss.getSheetByName(SHEET_PARTICIPANTS);
        if (!sheet) {
          // Если по какой-то причине листа нет, запустим setup
          setup();
        }

        const activeSheet = ss.getSheetByName(SHEET_PARTICIPANTS);
        const lastRow = activeSheet.getLastRow();
        if (lastRow >= 2) {
          // Оптимизация поиска дубликатов: читаем только колонку чеков и надежно сравниваем
          const receiptsRange = activeSheet
            .getRange(2, 1, lastRow - 1, 1)
            .getValues();
          const receiptSet = new Set(
            receiptsRange.map((row) => cleanReceipt(row[0])),
          );
          if (receiptSet.has(cleanReceipt(receipt))) {
            return ContentService.createTextOutput(
              JSON.stringify({
                success: false,
                message: "Такой номер чека уже зарегистрирован",
              }),
            ).setMimeType(ContentService.MimeType.JSON);
          }
        }

        const todayDate = Utilities.formatDate(
          new Date(),
          Session.getScriptTimeZone(),
          "yyyy-MM-dd HH:mm:ss",
        );
        activeSheet.appendRow([
          "'" + receipt, // A: ФД
          checkTime, // B: Время чека
          amount, // C: Сумма
          name, // D: Имя
          "'" + normalizedPhone, // E: Телефон
          todayDate, // F: Дата регистрации
          "", // G: Статус
        ]);

        return ContentService.createTextOutput(
          JSON.stringify({
            success: true,
            message: "Успешно зарегистрировано",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      } finally {
        lock.releaseLock();
      }
    }

    if (data.action === "drawWinner") {
      const token = data.token;
      const cache = CacheService.getScriptCache();
      const adminUser = token ? cache.get("auth_" + token) : null;
      if (!token || !adminUser) {
        return ContentService.createTextOutput(
          JSON.stringify({ success: false, message: "Необходима авторизация" }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      const lock = LockService.getScriptLock();
      try {
        lock.waitLock(30000);
      } catch (e) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message: "Сервер занят. Попробуйте розыгрыш снова.",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      try {
        const sheet = ss.getSheetByName(SHEET_PARTICIPANTS);
        const winSheet = ss.getSheetByName(SHEET_WINNERS);
        if (!sheet || !winSheet) {
          setup();
        }
        const activeSheet = ss.getSheetByName(SHEET_PARTICIPANTS);
        const activeWinSheet = ss.getSheetByName(SHEET_WINNERS);

        const values = activeSheet.getDataRange().getValues();

        let eligible = [];
        for (let i = 1; i < values.length; i++) {
          if (values[i][6] !== "Победитель") {
            // Column G is index 6
            eligible.push({ rowIndex: i + 1, data: values[i] });
          }
        }

        if (eligible.length === 0) {
          return ContentService.createTextOutput(
            JSON.stringify({
              success: false,
              message: "Нет доступных участников для розыгрыша",
            }),
          ).setMimeType(ContentService.MimeType.JSON);
        }

        const PRIZES = [
          "Смартфон Redmi Note 15 Pro Plus 5G 8/256",
          "Матрас туристический Youpin One Night Automatic Inflatable Leisure Bed PS1",
          "Видеорегистратор HOCO DV8 with rear camera",
          "Наушники Baseus Bluetooth BH1 NC Black",
          "Часы Xiaomi Redmi Watch 5 Active",
          "Колонка Blackview Aurabass 3",
          "Весы Xiaomi Mi Body Composition Scale S400",
          "Наушники Redmi Buds 6 Play",
          "Ночник Cute Panda",
          "Наушники Xiaomi Headphones Basic",
        ];

        // Новое логика: находим первый свободный приз
        const usedPrizes = [];
        const winValues = activeWinSheet.getDataRange().getValues();
        for (let i = 1; i < winValues.length; i++) {
          let pVal = winValues[i][3];
          let parsed = parsePrize(pVal);
          if (typeof parsed === "number" && !isNaN(parsed)) {
            usedPrizes.push(parsed); // Колонка D (index 3) - это номер приза
          }
        }

        let prizeIndex = -1;
        for (let i = PRIZES.length; i >= 1; i--) {
          if (!usedPrizes.includes(i)) {
            prizeIndex = i;
            break;
          }
        }

        if (prizeIndex === -1) {
          return ContentService.createTextOutput(
            JSON.stringify({
              success: false,
              message: "Все главные призы (10 мест) уже разыграны!",
            }),
          ).setMimeType(ContentService.MimeType.JSON);
        }

        // --- End of prize assignment fix ---

        const bytes = Utilities.computeDigest(
          Utilities.DigestAlgorithm.SHA_256,
          Utilities.getUuid() + Date.now(),
        );

        let randomNumber = 0;
        for (let i = 0; i < 4; i++) {
          randomNumber = (randomNumber << 8) + (bytes[i] & 255);
        }
        randomNumber = Math.abs(randomNumber);

        const winnerObj = eligible[randomNumber % eligible.length];
        const winnerData = winnerObj.data;

        // Обновляем статус в листе Участники (Колонка G = 7)
        activeSheet.getRange(winnerObj.rowIndex, 7).setValue("Победитель");

        const drawDate = Utilities.formatDate(
          new Date(),
          Session.getScriptTimeZone(),
          "yyyy-MM-dd HH:mm:ss",
        );

        // Лист Победители: ФД (A), Имя (B), Телефон (C), Приз (D), Дата розыгрыша (E)
        activeWinSheet.appendRow([
          "'" + winnerData[0], // ФД
          winnerData[3], // Имя
          "'" + winnerData[4], // Телефон
          "'" + prizeIndex, // Приз
          drawDate, // Дата розыгрыша
        ]);

        // Логируем действие администратора
        logAction("DRAW_WINNER", winnerData[0], adminUser);

        return ContentService.createTextOutput(
          JSON.stringify({
            success: true,
            message: "Победитель выбран",
            winner: {
              receipt: winnerData[0],
              name: winnerData[3],
              phone: winnerData[4],
              prize: prizeIndex,
            },
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      } finally {
        lock.releaseLock();
      }
    }

    if (data.action === "removeWinner") {
      const token = data.token;
      const cache = CacheService.getScriptCache();
      const adminUser = token ? cache.get("auth_" + token) : null;
      if (!token || !adminUser) {
        return ContentService.createTextOutput(
          JSON.stringify({ success: false, message: "Необходима авторизация" }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      const receiptToRemove = String(data.receipt).trim();

      const lock = LockService.getScriptLock();
      try {
        lock.waitLock(30000);
      } catch (e) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message: "Сервер занят. Попробуйте удалить победителя снова.",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      try {
        const sheet = ss.getSheetByName(SHEET_PARTICIPANTS);
        const winSheet = ss.getSheetByName(SHEET_WINNERS);

        const targetClean = cleanReceipt(receiptToRemove);

        // Удаляем из листа "Победители"
        if (winSheet) {
          const winData = winSheet.getDataRange().getValues();
          for (let i = winData.length - 1; i >= 1; i--) {
            if (cleanReceipt(winData[i][0]) === targetClean) {
              winSheet.deleteRow(i + 1);
            }
          }
        }

        // Снимаем статус "Победитель" у участника в колонке G (7)
        if (sheet) {
          const values = sheet.getDataRange().getValues();
          for (let i = 1; i < values.length; i++) {
            if (cleanReceipt(values[i][0]) === targetClean) {
              sheet.getRange(i + 1, 7).setValue("");
            }
          }
        }

        // Логируем действие администратора
        logAction("REMOVE_WINNER", receiptToRemove, adminUser);

        return ContentService.createTextOutput(
          JSON.stringify({
            success: true,
            message:
              "Победитель успешно удален из списка и статус участника сброшен",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      } finally {
        lock.releaseLock();
      }
    }

    if (data.action === "removeParticipant") {
      const token = data.token;
      const cache = CacheService.getScriptCache();
      const adminUser = token ? cache.get("auth_" + token) : null;
      if (!token || !adminUser) {
        return ContentService.createTextOutput(
          JSON.stringify({ success: false, message: "Необходима авторизация" }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      const receiptToRemove = String(data.receipt).trim();

      const lock = LockService.getScriptLock();
      try {
        lock.waitLock(30000);
      } catch (e) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message: "Сервер занят. Попробуйте удалить участника снова.",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      try {
        const sheet = ss.getSheetByName(SHEET_PARTICIPANTS);
        const winSheet = ss.getSheetByName(SHEET_WINNERS);

        const targetClean = cleanReceipt(receiptToRemove);

        // Удаляем из листа "Участники"
        if (sheet) {
          const values = sheet.getDataRange().getValues();
          for (let i = values.length - 1; i >= 1; i--) {
            if (cleanReceipt(values[i][0]) === targetClean) {
              sheet.deleteRow(i + 1);
            }
          }
        }

        // Удаляем из листа "Победители" (если он победитель)
        if (winSheet) {
          const winData = winSheet.getDataRange().getValues();
          for (let i = winData.length - 1; i >= 1; i--) {
            if (cleanReceipt(winData[i][0]) === targetClean) {
              winSheet.deleteRow(i + 1);
            }
          }
        }

        // Логируем действие администратора
        logAction("REMOVE_PARTICIPANT", receiptToRemove, adminUser);

        return ContentService.createTextOutput(
          JSON.stringify({
            success: true,
            message: "Участник успешно удален из всех списков",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      } finally {
        lock.releaseLock();
      }
    }

    if (data.action === "clearAllData") {
      const token = data.token;
      const cache = CacheService.getScriptCache();
      const adminUser = token ? cache.get("auth_" + token) : null;
      if (!token || !adminUser) {
        return ContentService.createTextOutput(
          JSON.stringify({ success: false, message: "Необходима авторизация" }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      const lock = LockService.getScriptLock();
      try {
        lock.waitLock(30000);
      } catch (e) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message: "Сервер занят. Попробуйте снова.",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      try {
        const sheet = ss.getSheetByName(SHEET_PARTICIPANTS);
        const winSheet = ss.getSheetByName(SHEET_WINNERS);

        if (sheet) {
          const lastRow = sheet.getLastRow();
          if (lastRow >= 2) {
            sheet.deleteRows(2, lastRow - 1);
          }
        }

        if (winSheet) {
          const lastRow = winSheet.getLastRow();
          if (lastRow >= 2) {
            winSheet.deleteRows(2, lastRow - 1);
          }
        }

        // Логируем действие администратора
        logAction("CLEAR_ALL_DATA", "all", adminUser);

        return ContentService.createTextOutput(
          JSON.stringify({
            success: true,
            message: "Все зарегистрированные участники и победители были успешно удалены",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      } finally {
        lock.releaseLock();
      }
    }

    if (data.action === "saveSettings") {
      const token = data.token;
      const cache = CacheService.getScriptCache();
      const adminUser = token ? cache.get("auth_" + token) : null;
      if (!token || !adminUser) {
        return ContentService.createTextOutput(
          JSON.stringify({ success: false, message: "Необходима авторизация" }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      const lock = LockService.getScriptLock();
      try {
        lock.waitLock(30000);
      } catch (e) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message: "Сервер занят. Попробуйте обновить настройки позже.",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      try {
        let sheet = ss.getSheetByName(SHEET_SETTINGS);
        if (!sheet) {
          setup();
          sheet = ss.getSheetByName(SHEET_SETTINGS);
        }

        sheet.clear();
        sheet.appendRow(["Ключ", "Значение"]);
        sheet.appendRow(["startDate", String(data.startDate || "")]);
        sheet.appendRow(["endDate", String(data.endDate || "")]);
        sheet.appendRow(["drawDate", String(data.drawDate || "")]);
        sheet.appendRow([
          "registrationEnabled",
          String(data.registrationEnabled !== false),
        ]);
        sheet.appendRow([
          "winnersPublished",
          String(data.winnersPublished === true),
        ]);

        // Логируем действие администратора в "Логи"
        logAction(
          "UPDATE_SETTINGS",
          "start:" +
            data.startDate +
            "|end:" +
            data.endDate +
            "|draw:" +
            data.drawDate +
            "|reg:" +
            data.registrationEnabled +
            "|pub:" +
            data.winnersPublished,
          adminUser,
        );

        return ContentService.createTextOutput(
          JSON.stringify({
            success: true,
            message: "Настройки успешно сохранены",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      } finally {
        lock.releaseLock();
      }
    }

    return ContentService.createTextOutput(
      JSON.stringify({
        success: false,
        message: "Неизвестное действие (action)",
      }),
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, message: err.toString() }),
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// Вспомогательная функция для надежного сравнения номеров чеков
function cleanReceipt(r) {
  let s = String(r).trim().replace(/^'/, "");
  if (s.endsWith(".0")) {
    s = s.substring(0, s.length - 2);
  }
  return s;
}

// Вспомогательная функция для логирования действий администратора
function logAction(actionName, receipt, adminUser) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let logSheet = ss.getSheetByName(SHEET_LOGS);
    if (!logSheet) {
      logSheet = ss.insertSheet(SHEET_LOGS);
      logSheet.appendRow(["Дата", "Действие", "Чек", "Админ"]);
    }
    const currentDate = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      "yyyy-MM-dd HH:mm:ss",
    );
    logSheet.appendRow([
      currentDate,
      actionName,
      "'" + receipt,
      adminUser || "unknown",
    ]);
  } catch (err) {
    console.error("Ошибка при записи лога:", err);
  }
}
