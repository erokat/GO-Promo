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
    s.appendRow(["Номер чека", "Имя", "Телефон", "Дата", "Статус"]);
  }
  if (!ss.getSheetByName(SHEET_WINNERS)) {
    let s = ss.insertSheet(SHEET_WINNERS);
    s.appendRow(["Номер чека", "Имя", "Телефон", "Дата розыгрыша"]);
  }
  if (!ss.getSheetByName(SHEET_LOGS)) {
    let s = ss.insertSheet(SHEET_LOGS);
    s.appendRow(["Дата", "Действие", "Чек", "Админ"]);
  }
  if (!ss.getSheetByName(SHEET_SETTINGS)) {
    let s = ss.insertSheet(SHEET_SETTINGS);
    s.appendRow(["Ключ", "Значение"]);
    s.appendRow(["startDate", "2026-05-22T00:00:00"]);
    s.appendRow(["endDate", "2026-06-10T23:50:59"]);
    s.appendRow(["drawDate", "2026-07-02T00:00:00"]);
    s.appendRow(["registrationEnabled", "true"]);
  }
}

// Вспомогательная функция для чтения настроек
function getSettings(ss) {
  const sheet = ss.getSheetByName(SHEET_SETTINGS);
  const settings = {
    startDate: "2026-05-22T00:00:00",
    endDate: "2026-06-10T23:50:59",
    drawDate: "2026-07-02T00:00:00",
    registrationEnabled: "true"
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
    const sheet = ss.getSheetByName(SHEET_WINNERS);
    if (!sheet)
      return ContentService.createTextOutput(
        JSON.stringify({ success: true, winners: [] }),
      ).setMimeType(ContentService.MimeType.JSON);

    const data = sheet.getDataRange().getValues();
    const winners = [];

    for (let i = 1; i < data.length; i++) {
      winners.push({
        receipt: data[i][0],
        name: data[i][1],
        phone: data[i][2],
        date: data[i][3],
      });
    }

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

    // Номер чека (0), Имя (1), Телефон (2), Дата (3), Статус (4)
    for (let i = 1; i < data.length; i++) {
      participants.push({
        receipt: data[i][0],
        name: data[i][1],
        phone: data[i][2],
        date: data[i][3],
        won: data[i][4] === "Победитель",
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
        throw new Error("ADMIN_LOGIN или ADMIN_PASSWORD не настроены в Script Properties");
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

      // Номер чека (0), Имя (1), Телефон (2), Дата (3), Статус (4)
      for (let i = 1; i < valData.length; i++) {
        participantsList.push({
          receipt: valData[i][0],
          name: valData[i][1],
          phone: valData[i][2],
          date: valData[i][3],
          won: valData[i][4] === "Победитель",
        });
      }

      return ContentService.createTextOutput(
        JSON.stringify({ success: true, participants: participantsList }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === "register") {
      // Проверка периода регистрации по динамическим настройкам в таблице
      const settings = getSettings(ss);
      if (settings.registrationEnabled === "false" || settings.registrationEnabled === false) {
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

      if (!data.receipt || !data.name || !data.phone) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message: "Не заполнены обязательные поля (receipt, name, phone)",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      const name = String(data.name).trim();
      // Ограничение длины имени до 100 символов
      if (name.length < 2 || name.length > 100) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message: "Имя должно быть длиной от 2 до 100 символов",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      const receipt = String(data.receipt).trim();

      // Ровно 12 цифр
      if (!/^\d{12}$/.test(receipt)) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message: "Неверный номер чека",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      // Первые 6 цифр должны быть 000081
      if (!receipt.startsWith("000081")) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            message: "Неверный номер чека",
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
            message: "Некорректный номер телефона (должен состоять ровно из 8 цифр)",
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
            message: "Сервер перегружен запросами. Пожалуйста, попробуйте еще раз.",
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
          const receiptsRange = activeSheet.getRange(2, 1, lastRow - 1, 1).getValues();
          const receiptSet = new Set(receiptsRange.map(row => cleanReceipt(row[0])));
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
          "'" + receipt,
          name,
          "'" + normalizedPhone,
          todayDate,
          "",
        ]);

        return ContentService.createTextOutput(
          JSON.stringify({ success: true, message: "Успешно зарегистрировано" }),
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
          JSON.stringify({ success: false, message: "Сервер занят. Попробуйте розыгрыш снова." }),
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
          if (values[i][4] !== "Победитель") {
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

        const randomBytes = Utilities.getUuid().replace(/-/g, "");
        const randomNumber = parseInt(randomBytes.substring(0, 8), 16);
        const winnerObj = eligible[randomNumber % eligible.length];
        const winnerData = winnerObj.data;

        // Обновляем статус
        activeSheet.getRange(winnerObj.rowIndex, 5).setValue("Победитель");

        const drawDate = Utilities.formatDate(
          new Date(),
          Session.getScriptTimeZone(),
          "yyyy-MM-dd HH:mm:ss",
        );
        activeWinSheet.appendRow([
          "'" + winnerData[0],
          winnerData[1],
          "'" + winnerData[2],
          drawDate,
        ]);

        // Логируем действие администратора
        logAction("DRAW_WINNER", winnerData[0], adminUser);

        return ContentService.createTextOutput(
          JSON.stringify({
            success: true,
            message: "Победитель выбран",
            winner: {
              receipt: winnerData[0],
              name: winnerData[1],
              phone: winnerData[2],
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
          JSON.stringify({ success: false, message: "Сервер занят. Попробуйте удалить победителя снова." }),
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

        // Снимаем статус "Победитель" у участника
        if (sheet) {
          const values = sheet.getDataRange().getValues();
          for (let i = 1; i < values.length; i++) {
            if (cleanReceipt(values[i][0]) === targetClean) {
              sheet.getRange(i + 1, 5).setValue("");
            }
          }
        }

        // Логируем действие администратора
        logAction("REMOVE_WINNER", receiptToRemove, adminUser);

        return ContentService.createTextOutput(
          JSON.stringify({
            success: true,
            message: "Победитель успешно удален из списка и статус участника сброшен",
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
          JSON.stringify({ success: false, message: "Сервер занят. Попробуйте обновить настройки позже." }),
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
        sheet.appendRow(["registrationEnabled", String(data.registrationEnabled !== false)]);

        // Логируем действие администратора в "Логи"
        logAction("UPDATE_SETTINGS", "start:" + data.startDate + "|end:" + data.endDate + "|draw:" + data.drawDate + "|reg:" + data.registrationEnabled, adminUser);

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

// Вспомогательная функция для надежного сравнения номеров чеков (нормализует строки, удаляя лидирующие нули и лишние детали)
function cleanReceipt(r) {
  let s = String(r).trim().replace(/^'/, '');
  if (s.endsWith('.0')) {
    s = s.substring(0, s.length - 2);
  }
  // Удаляем лидирующие нули для сравнения числового значения чеков
  if (/^\d+$/.test(s)) {
    s = s.replace(/^0+/, '');
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
