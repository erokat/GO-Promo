/**
 * Основной скрипт сайта: логика регистрации, отрисовка победителей и админ-панель.
 */

document.addEventListener("DOMContentLoaded", async () => {
  // ---- СОСТОЯНИЕ И КОНФИГУРАЦИЯ ----
  let config = {};
  let participants = []; // Локальная база для демо-режима
  let winners = []; // Локальные победители для демо-режима
  let isAdmin = false;
  let adminToken = null; // Токен авторизации
  let currentWinnersCount = 0;
  let displayedParticipants = 0;
  const PAGE_SIZE = 20;

  // DOM-элементы (Секции)
  const mainView = document.getElementById("mainView");
  const adminView = document.getElementById("adminView");
  const loginModal = document.getElementById("loginModal");
  const setupModal = document.getElementById("setupModal");

  // ДОМ-элементы (Кнопки)
  const adminLoginBtn = document.getElementById("adminLoginBtn");
  const adminLogoutBtn = document.getElementById("adminLogoutBtn");
  const closeModalBtn = document.getElementById("closeModalBtn");
  const closeSetupBtn = document.getElementById("closeSetupBtn");
  const loadMoreBtn = document.getElementById("loadMoreBtn");

  // Формы
  const promoForm = document.getElementById("promoForm");
  const loginForm = document.getElementById("loginForm");

  let useMock = false;

  // Вспомогательная функция загрузки динамических настроек
  async function loadSettings() {
    if (useMock) {
      const saved = localStorage.getItem("lottery_settings");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          config.startDate = parsed.startDate;
          config.endDate = parsed.endDate;
          config.drawDate = parsed.drawDate;
          config.registrationEnabled = parsed.registrationEnabled === "true" || parsed.registrationEnabled === true;
        } catch (e) {
          console.error("Ошибка при чтении локальных настроек:", e);
        }
      }
      return;
    }

    try {
      const url = new URL(config.googleScriptUrl);
      url.searchParams.append("action", "getSettings");
      const res = await fetch(url.toString());
      const data = await res.json();
      if (data.success && data.settings) {
        config.startDate = data.settings.startDate;
        config.endDate = data.settings.endDate;
        config.drawDate = data.settings.drawDate;
        config.registrationEnabled = data.settings.registrationEnabled === "true" || data.settings.registrationEnabled === true;
      }
    } catch (err) {
      console.warn("Ошибка при получении настроек с сервера. Используем локальный конфигурационный файл.", err);
    }
  }

  // 1. Инициализация (Загрузка конфигурации)
  try {
    const res = await fetch("config.json?v=" + Date.now());
    config = await res.json();
    useMock = !config.googleScriptUrl || config.googleScriptUrl.trim() === "";
    
    // Загружаем динамические настройки из Google Sheets / LocalStorage
    await loadSettings();
    
    checkRegistrationPeriod();
  } catch (err) {
    console.error("ОШИБКА: Не удалось загрузить config.json", err);
    useMock = true; // Fallback на демо-режим при явной ошибке
  }

  function checkRegistrationPeriod() {
    const btn = document.getElementById("submitBtn");
    const msg = document.getElementById("formMessage");
    if (!btn) return true;

    // Принудительное отключение
    if (config.registrationEnabled === false) {
      btn.disabled = true;
      btn.style.opacity = "0.6";
      btn.style.cursor = "not-allowed";
      btn.textContent = "Регистрация закрыта";
      if (msg) {
        msg.textContent = "Регистрация временно приостановлена администратором.";
        msg.className = "message error";
      }
      return false;
    }

    const now = new Date();

    if (config.startDate) {
      const start = new Date(config.startDate);
      if (now < start) {
        btn.disabled = true;
        btn.style.opacity = "0.6";
        btn.style.cursor = "not-allowed";
        btn.textContent = "Регистрация еще не началась";
        if (msg) {
          msg.textContent = `Регистрация чеков начнется ${start.toLocaleDateString("ru-RU", { day: 'numeric', month: 'long', year: 'numeric' })} в ${start.toLocaleTimeString("ru-RU", { hour: '2-digit', minute: '2-digit' })}.`;
          msg.className = "message info";
        }
        return false;
      }
    }

    if (config.endDate) {
      const end = new Date(config.endDate);
      if (now > end) {
        btn.disabled = true;
        btn.style.opacity = "0.6";
        btn.style.cursor = "not-allowed";
        btn.textContent = "Регистрация завершена";
        if (msg) {
          msg.textContent = `Регистрация чеков завершена ${end.toLocaleDateString("ru-RU", { day: 'numeric', month: 'long', year: 'numeric' })} в ${end.toLocaleTimeString("ru-RU", { hour: '2-digit', minute: '2-digit' })}.`;
          msg.className = "message error";
        }
        return false;
      }
    }

    btn.disabled = false;
    btn.style.opacity = "1";
    btn.style.cursor = "pointer";
    btn.textContent = "Зарегистрировать чек";
    if (msg) {
      msg.textContent = "";
      msg.className = "message";
    }
    return true;
  }

  // ---- ЛОГИКА ОТСЧЕТА ВРЕМЕНИ ----
  let countdownInterval;

  function getTargetDrawTime() {
    return config.drawDate
      ? new Date(config.drawDate).getTime()
      : new Date(Date.now() + 86400000).getTime(); // fallback 1 день
  }

  function updateCountdown() {
    const now = new Date().getTime();
    const distance = getTargetDrawTime() - now;

    const cdDaysElem = document.getElementById("cdDays");
    const cdHoursElem = document.getElementById("cdHours");
    const cdMinutesElem = document.getElementById("cdMinutes");
    const cdSecondsElem = document.getElementById("cdSeconds");
    const cdMessageElem = document.getElementById("countdownMessage");
    const cdTitleElem = document.getElementById("countdownTitle");
    const countdownElem = document.getElementById("countdown");

    if (distance < 0) {
      if (cdDaysElem) cdDaysElem.innerText = "00";
      if (cdHoursElem) cdHoursElem.innerText = "00";
      if (cdMinutesElem) cdMinutesElem.innerText = "00";
      if (cdSecondsElem) cdSecondsElem.innerText = "00";

      if (cdMessageElem) cdMessageElem.classList.remove("hidden");
      if (countdownElem) countdownElem.style.opacity = "0.5";
      if (cdTitleElem) cdTitleElem.innerText = "Розыгрыш завершен:";

      checkWinnersVisibility();
      return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor(
      (distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
    );
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    if (cdDaysElem) cdDaysElem.innerText = days.toString().padStart(2, "0");
    if (cdHoursElem) cdHoursElem.innerText = hours.toString().padStart(2, "0");
    if (cdMinutesElem)
      cdMinutesElem.innerText = minutes.toString().padStart(2, "0");
    if (cdSecondsElem)
      cdSecondsElem.innerText = seconds.toString().padStart(2, "0");
  }

  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);

  if (useMock) {
    console.warn(
      "API URL от Google Sheets не настроен. Используются локальные демо-данные.",
    );
    // Генерируем фейковые данные участников для возможности тестирования админки
    for (let i = 1; i <= 65; i++) {
      participants.push({
        receipt: "100" + Math.floor(1000 + Math.random() * 9000),
        name: "Демо Участник " + i,
        phone: "+373 " + Math.floor(10000000 + Math.random() * 90000000),
        date: new Date(
          Date.now() - Math.random() * 10000000000,
        ).toLocaleDateString(),
        won: false,
      });
    }
    // Показываем инструкцию администратору
    setupModal.classList.remove("hidden");
  }

  // ---- ОБРАБОТЧИКИ СОБЫТИЙ ----

  // Открытие модальных окон
  adminLoginBtn.addEventListener("click", () =>
    loginModal.classList.remove("hidden"),
  );
  closeModalBtn.addEventListener("click", () =>
    loginModal.classList.add("hidden"),
  );
  closeSetupBtn.addEventListener("click", () =>
    setupModal.classList.add("hidden"),
  );

  // Авторизация администратора
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = document.getElementById("adminUser").value;
    const pass = document.getElementById("adminPass").value;
    const msg = document.getElementById("loginMessage");
    const btn = loginForm.querySelector('button[type="submit"]');

    /* 
           ПРИМЕЧАНИЕ О БЕЗОПАСНОСТИ:
           Теперь пароли не хранятся на клиенте.
           Мы отправляем логин и пароль в Google Apps Script для проверки на сервере.
           Если данные верны, скрипт вернет success: true.
        */
    msg.className = "message";
    btn.disabled = true;
    btn.textContent = "Вход...";

    try {
      if (useMock) {
        // В демо-режиме используем любой пароль/логин, например admin/admin
        if (user === "admin" && pass === "admin") {
          proceedLogin();
        } else {
          showLoginError();
        }
      } else {
        // БОЕВОЙ РЕЖИМ: Отправляем запрос на GAS
        const payload = { action: "login", login: user, password: pass };

        const res = await fetch(config.googleScriptUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload),
        });

        const responseData = await res.json();

        if (responseData.success) {
          adminToken = responseData.token;
          proceedLogin();
        } else {
          showLoginError(responseData.message);
        }
      }
    } catch (err) {
      showLoginError("Ошибка связи с сервером");
      console.error("Login error:", err);
    } finally {
      btn.disabled = false;
      btn.textContent = "Вход";
    }

    function proceedLogin() {
      isAdmin = true;
      loginModal.classList.add("hidden");
      mainView.classList.add("hidden");
      adminView.classList.remove("hidden");
      adminLoginBtn.classList.add("hidden");
      adminLogoutBtn.classList.remove("hidden");
      loginForm.reset();
      msg.className = "message";

      // Инициализируем данные панели администратора
      loadAdminData();
    }

    function showLoginError(text = "Неверный логин или пароль") {
      msg.textContent = text;
      msg.className = "message error";
    }
  });

  // Выход из админки
  adminLogoutBtn.addEventListener("click", () => {
    isAdmin = false;
    adminToken = null;
    adminView.classList.add("hidden");
    mainView.classList.remove("hidden");
    adminLogoutBtn.classList.add("hidden");
    adminLoginBtn.classList.remove("hidden");

    // Обновляем список победителей на главной
    loadWinners();
  });

  // Регистрация чека
  promoForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submitBtn");
    const msg = document.getElementById("formMessage");

    if (!checkRegistrationPeriod()) {
      return;
    }

    const receipt = document.getElementById("receipt").value.trim();
    const name = document.getElementById("name").value.trim();
    const phoneInput = document.getElementById("phone").value.trim();

    // Ограничение длины имени
    if (name.length < 2 || name.length > 100) {
      msg.textContent = "Имя должно быть длиной от 2 до 100 символов.";
      msg.className = "message error";
      return;
    }

    // Проверка номера ФД
    if (!/^000081\d{6}$/.test(receipt)) {
      msg.textContent = "Неверный номер чека";
      msg.className = "message error";
      return;
    }

    // Нормализация номера телефона (удаляем +373 и 373, а также любые не-цифры)
    let normalizedPhone = phoneInput.replace(/\D/g, "");
    if (normalizedPhone.indexOf("373") === 0) {
      normalizedPhone = normalizedPhone.substring(3);
    }

    if (!/^\d{8}$/.test(normalizedPhone)) {
      msg.textContent = "Пожалуйста, введите корректный номер телефона (должен состоять ровно из 8 цифр, например, 77712345).";
      msg.className = "message error";
      return;
    }

    msg.className = "message";
    btn.disabled = true;
    btn.textContent = "Отправка...";

    try {
      if (useMock) {
        // ДЕМО-РЕЖИМ: имитация задержки сети
        await new Promise((r) => setTimeout(r, 600));

        // Проверка уникальности
        if (participants.find((p) => p.receipt === receipt)) {
          throw new Error("Чек с таким номером уже зарегистрирован.");
        }

        participants.unshift({
          receipt,
          name,
          phone: normalizedPhone,
          date: new Date().toLocaleDateString(),
          won: false,
        });

        msg.textContent = "Успех! Чек успешно зарегистрирован.";
        msg.className = "message success";
        promoForm.reset();
      } else {
        // БОЕВОЙ РЕЖИМ: Отправка данных в Google Apps Script
        const payload = { action: "register", receipt, name, phone: normalizedPhone };

        const res = await fetch(config.googleScriptUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload),
        });

        const responseText = await res.text();
        let responseData;
        try {
          responseData = JSON.parse(responseText);
        } catch (e) {
          console.error("Неверный ответ от сервера:", responseText);
          throw new Error(
            "Произошла ошибка при регистрации. Пожалуйста, проверьте настройки Google Apps Script.",
          );
        }

        if (!responseData.success) {
          throw new Error(responseData.message || "Ошибка регистрации");
        }

        msg.textContent =
          responseData.message || "Чек успешно зарегистрирован! Желаем удачи.";
        msg.className = "message success";
        promoForm.reset();
      }
    } catch (err) {
      msg.textContent =
        err.message || "Произошла ошибка регистрации. Попробуйте позже.";
      msg.className = "message error";
    } finally {
      btn.disabled = false;
      btn.textContent = "Зарегистрировать чек";
    }
  });

  // ---- ФУНКЦИИ ФРОНТЕНДА ----

  function checkWinnersVisibility() {
    // Условие отображения секции победителей
    const timeIsUp = new Date().getTime() > getTargetDrawTime();
    const hasWinners = currentWinnersCount > 0;

    const winnersSection = document.querySelector(".winners-section");
    if (winnersSection) {
      // Либо таймер истек, либо уже есть победители
      if (timeIsUp || hasWinners) {
        winnersSection.style.display = "block";
      } else {
        winnersSection.style.display = "none";
      }
    }
  }

  // Функция экранирования HTML для предотвращения XSS
  function escapeHTML(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Форматирование даты
  function formatDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d
      .toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
      .replace(",", "");
  }

  // Загрузка Победителей на главной странице
  async function loadWinners() {
    const list = document.getElementById("winnersList");
    try {
      let data = [];
      if (useMock) {
        data = winners;
      } else {
        // БОЕВОЙ РЕЖИМ: Запрашиваем победителей из Google Sheets
        const url = new URL(config.googleScriptUrl);
        url.searchParams.append("action", "winners");
        const res = await fetch(url.toString());
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          if (json.success) {
            data = json.winners || [];
            winners = data;
          } else {
            data = [];
            winners = [];
          }
        } catch (e) {
          console.warn("GAS не вернул JSON. Ответ сервера:", text);
          data = [];
          winners = [];
        }
      }

      currentWinnersCount = data.length;
      checkWinnersVisibility();

      list.innerHTML = "";
      // Если победителей еще нет
      if (data.length === 0) {
        list.innerHTML =
          '<p style="grid-column: 1/-1; text-align:center; color:#777; font-size: 1.1rem;">Итоги подводятся, ожидайте публикации списков!</p>';
        return;
      }

      // Отрисовка карточек победителей
      data.forEach((w) => {
        const card = document.createElement("div");
        card.className = "winner-card";

        // Частично скрываем чек (Оставляем первые и последние символы)
        let r = String(w.receipt);
        let masked =
          r.length >= 6
            ? r.substring(0, 2) +
              "*".repeat(r.length - 4) +
              r.substring(r.length - 2)
            : "***";

        card.innerHTML = `
                    <h4>${escapeHTML(w.name)}</h4>
                    <div class="receipt">Чек: ${escapeHTML(masked)}</div>
                    <div class="date"><small>Дата розыгрыша: ${escapeHTML(formatDate(w.date))}</small></div>
                `;
        list.appendChild(card);
      });
    } catch (err) {
      console.error(err);
      list.innerHTML =
        '<p class="error" style="grid-column: 1/-1;">Ошибка загрузки списка победителей.</p>';
    }
  }

  // ---- ФУНКЦИИ ПАНЕЛИ АДМИНИСТРАТОРА ----

  async function loadAdminData() {
    displayedParticipants = 0;
    document.getElementById("participantsBody").innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 40px; color: var(--text-muted, #888);">
          <div class="loader-spinner" style="display: inline-block; width: 22px; height: 22px; border: 2.5px solid #333; border-top-color: var(--primary, #00a658); border-radius: 50%; animation: spin 1s linear infinite; margin-right: 12px; vertical-align: middle;"></div>
          Загрузка участников из Google Таблиц...
        </td>
      </tr>
    `;

    if (useMock) {
      await loadWinners();
      renderAdminStats();
      renderParticipants(participants);
      return;
    }

    try {
      // Выгружаем победителей и участников параллельно для ускорения входа
      const [_, res] = await Promise.all([
        loadWinners().catch(err => console.error("Ошибка загрузки победителей:", err)),
        fetch(config.googleScriptUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ action: "participants", token: adminToken }),
        }).then(r => r.json()).catch(err => {
          console.error("Ошибка загрузки участников:", err);
          return { success: false };
        })
      ]);

      if (res && res.success) {
        participants = res.participants || [];
      }
    } catch (err) {
      console.error("Ошибка при загрузке данных админки:", err);
    }

    renderAdminStats();
    renderParticipants(participants);
  }

  function renderAdminStats() {
    document.getElementById("statTotalParticipants").textContent =
      participants.length;
    document.getElementById("statTotalWinners").textContent = winners.length;
  }

  // Отрисовка таблицы с пагинацией (по кнопке "Показать еще")
  function renderParticipants(list) {
    const tbody = document.getElementById("participantsBody");
    tbody.innerHTML = ""; // Очищаем таблицу

    // Сортировка: победители всегда в самом верху списка (без порчи исходного массива)
    const sorted = [...list].sort((a, b) => {
      const aWon = !!a.won;
      const bWon = !!b.won;
      if (aWon && !bWon) return -1;
      if (!aWon && bWon) return 1;
      return 0;
    });

    // Берем первые PAGE_SIZE (20)
    let toShow = sorted.slice(0, PAGE_SIZE);
    displayedParticipants = toShow.length;

    appendRows(toShow);

    // Если элементов больше, показываем кнопку дозагрузки
    if (sorted.length > displayedParticipants) {
      loadMoreBtn.classList.remove("hidden");
      loadMoreBtn.onclick = () => {
        let nextBatch = sorted.slice(
          displayedParticipants,
          displayedParticipants + PAGE_SIZE,
        );
        appendRows(nextBatch);
        displayedParticipants += nextBatch.length;
        if (displayedParticipants >= sorted.length) {
          loadMoreBtn.classList.add("hidden");
        }
      };
    } else {
      loadMoreBtn.classList.add("hidden");
    }
  }

  // Добавление строк в таблицу
  function appendRows(items) {
    const tbody = document.getElementById("participantsBody");
    items.forEach((p) => {
      const tr = document.createElement("tr");
      if (p.won) tr.style.backgroundColor = "rgba(46, 204, 113, 0.05)"; // Подсветка победителя
      tr.innerHTML = `
                <td><strong>${escapeHTML(p.receipt)}</strong></td>
                <td>${escapeHTML(p.name)}</td>
                <td>${escapeHTML(p.phone)}</td>
                <td>${escapeHTML(formatDate(p.date))}</td>
                <td>
                  ${p.won ? `
                    <span style="color:#2ecc71;font-weight:bold;margin-right:10px;">Победитель</span>
                    <button class="btn remove-winner-btn" data-receipt="${escapeHTML(p.receipt)}" style="padding: 4px 8px; font-size: 0.8rem; background-color: var(--error, #e74c3c); color: white; border: none; border-radius: 4px; cursor: pointer;">Сбросить победу</button>
                  ` : `<span style="color:#999;font-size:0.9rem;">Участник</span>`}
                </td>
            `;
      tbody.appendChild(tr);
    });
  }

  // ---- ПОДДЕРЖКА КРАСИВЫХ И БЕЗОПАСНЫХ ДИАЛОГОВ (БЕЗ БЛОКИРУЮЩИХ WINDOW.ALERT/CONFIRM) ----
  window.showConfirmDialog = (message) => {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal";
      overlay.style.zIndex = "3000";

      const content = document.createElement("div");
      content.className = "modal-content";
      content.style.maxWidth = "420px";
      content.style.padding = "30px";
      content.style.textAlign = "center";
      content.style.borderRadius = "12px";
      content.style.border = "1px solid #333";
      content.style.boxShadow = "0 20px 40px rgba(0,0,0,0.5)";

      const title = document.createElement("h3");
      title.textContent = "Подтверждение";
      title.style.marginBottom = "15px";
      title.style.fontSize = "1.3rem";
      title.style.color = "var(--error, #e74c3c)";

      const text = document.createElement("p");
      text.style.fontSize = "1rem";
      text.style.marginBottom = "25px";
      text.style.lineHeight = "1.6";
      text.style.color = "#ddd";
      text.textContent = message;

      const btnContainer = document.createElement("div");
      btnContainer.style.display = "flex";
      btnContainer.style.justifyContent = "center";
      btnContainer.style.gap = "15px";

      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn";
      cancelBtn.textContent = "Отмена";
      cancelBtn.style.padding = "10px 20px";
      cancelBtn.style.background = "#222";
      cancelBtn.style.color = "#ccc";
      cancelBtn.style.border = "1px solid #444";
      cancelBtn.style.cursor = "pointer";
      cancelBtn.style.borderRadius = "6px";

      const confirmBtn = document.createElement("button");
      confirmBtn.className = "btn";
      confirmBtn.textContent = "Да, сбросить";
      confirmBtn.style.padding = "10px 20px";
      confirmBtn.style.background = "var(--error, #e74c3c)";
      confirmBtn.style.color = "white";
      confirmBtn.style.border = "none";
      confirmBtn.style.cursor = "pointer";
      confirmBtn.style.borderRadius = "6px";
      confirmBtn.style.fontWeight = "bold";

      cancelBtn.onclick = () => {
        document.body.removeChild(overlay);
        resolve(false);
      };

      confirmBtn.onclick = () => {
        document.body.removeChild(overlay);
        resolve(true);
      };

      btnContainer.appendChild(cancelBtn);
      btnContainer.appendChild(confirmBtn);
      content.appendChild(title);
      content.appendChild(text);
      content.appendChild(btnContainer);
      overlay.appendChild(content);
      document.body.appendChild(overlay);
    });
  };

  window.showAlertDialog = (message, isSuccess = false) => {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal";
      overlay.style.zIndex = "3000";

      const content = document.createElement("div");
      content.className = "modal-content";
      content.style.maxWidth = "420px";
      content.style.padding = "30px";
      content.style.textAlign = "center";
      content.style.borderRadius = "12px";
      content.style.border = "1px solid #333";
      content.style.boxShadow = "0 20px 40px rgba(0,0,0,0.5)";

      const title = document.createElement("h3");
      title.style.marginBottom = "15px";
      title.style.fontSize = "1.3rem";
      if (isSuccess) {
        title.textContent = "Успешно!";
        title.style.color = "var(--primary, #00a658)";
      } else {
        title.textContent = "Уведомление";
        title.style.color = "#ffcc00";
      }

      const text = document.createElement("p");
      text.style.fontSize = "1rem";
      text.style.marginBottom = "25px";
      text.style.lineHeight = "1.6";
      text.style.color = "#ddd";
      text.textContent = message;

      const okBtn = document.createElement("button");
      okBtn.className = "btn";
      okBtn.textContent = "ОК";
      okBtn.style.padding = "10px 30px";
      okBtn.style.background = isSuccess ? "var(--primary, #00a658)" : "#444";
      okBtn.style.color = "white";
      okBtn.style.border = "none";
      okBtn.style.cursor = "pointer";
      okBtn.style.borderRadius = "6px";
      okBtn.style.fontWeight = "bold";

      okBtn.onclick = () => {
        document.body.removeChild(overlay);
        resolve();
      };

      content.appendChild(title);
      content.appendChild(text);
      content.appendChild(okBtn);
      overlay.appendChild(content);
      document.body.appendChild(overlay);
    });
  };

  // Регистрация глобальной функции сброса победы для 100%-ной надежности
  window.removeWinnerAction = async (receiptOrBtn, possibleBtn) => {
    let receipt;
    let btn;
    if (receiptOrBtn instanceof HTMLElement) {
      btn = receiptOrBtn;
      receipt = btn.getAttribute("data-receipt");
    } else {
      receipt = receiptOrBtn;
      btn = possibleBtn;
    }

    if (!receipt) {
      console.error("No receipt found or passed to removeWinnerAction");
      return;
    }

    const confirmed = await window.showConfirmDialog(`Вы действительно хотите аннулировать победу по чеку № ${receipt}?`);
    if (!confirmed) {
      return;
    }
    
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Удаление...";
    }
    
    try {
      if (useMock) {
        // Имитация в Демо-режиме
        await new Promise((r) => setTimeout(r, 500));
        
        // Удалить из winners
        winners = winners.filter(w => String(w.receipt).trim() !== String(receipt).trim());
        
        // Сбросить статус won у оригинального участника
        const p = participants.find(part => String(part.receipt).trim() === String(receipt).trim());
        if (p) {
          p.won = false;
        }
        
        await window.showAlertDialog("Победитель успешно удален (демо-режим).", true);
        await loadAdminData();
      } else {
        // Реальный режим
        const payload = { action: "removeWinner", token: adminToken, receipt: receipt };
        const res = await fetch(config.googleScriptUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (json.success) {
          await window.showAlertDialog(json.message || "Победитель успешно удален.", true);
          await loadAdminData();
        } else {
          await window.showAlertDialog("Ошибка: " + (json.message || "Не удалось удалить победителя"), false);
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Сбросить победу";
          }
        }
      }
    } catch (err) {
      console.error("Error removing winner:", err);
      await window.showAlertDialog("Произошла ошибка при связи с сервером.", false);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Сбросить победу";
      }
    }
  };

  // Делегирование клика для 100%-ной отказоустойчивости в таблице участников
  const participantsBody = document.getElementById("participantsBody");
  if (participantsBody) {
    participantsBody.addEventListener("click", (e) => {
      const btn = e.target.closest(".remove-winner-btn");
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        // Быстрый вызов нашей надежной функции
        window.removeWinnerAction(btn);
      }
    });
  }

  // Поиск по таблице (Живой поиск)
  document.getElementById("searchInput").addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase().trim();
    const filtered = participants.filter(
      (p) =>
        String(p.receipt || "").toLowerCase().includes(query) ||
        String(p.name || "").toLowerCase().includes(query) ||
        String(p.phone || "").toLowerCase().includes(query),
    );
    document.getElementById("participantsBody").innerHTML = "";
    renderParticipants(filtered);
  });

  // Механизм выбора победителя
  document
    .getElementById("drawWinnerBtn")
    .addEventListener("click", async () => {
      const msg = document.getElementById("drawMessage");
      const btn = document.getElementById("drawWinnerBtn");

      function showWinnerMessage(winner) {
        msg.innerHTML = `🎉 Победитель выбран!<br><strong style="font-size:1.2rem">${escapeHTML(winner.name)} (Чек: ${escapeHTML(winner.receipt)})</strong><br>Телефон: ${escapeHTML(winner.phone)}`;
        msg.className = "message success";
        msg.style.opacity = "1";
        msg.style.transition = "";

        // Автоматическое скрытие через 10 секунд
        if (window.winnerHideTimeout) {
          clearTimeout(window.winnerHideTimeout);
        }
        window.winnerHideTimeout = setTimeout(() => {
          msg.style.transition = "opacity 1s ease";
          msg.style.opacity = "0";
          
          window.winnerHideTimeout = setTimeout(() => {
            msg.textContent = "";
            msg.className = "message";
            msg.style.opacity = "";
            msg.style.transition = "";
          }, 1000);
        }, 10000);
      }

      if (!useMock) {
        btn.disabled = true;
        msg.className = "message";
        msg.textContent = "Идет розыгрыш...";
        try {
          const payload = { action: "drawWinner", token: adminToken };
          const res = await fetch(config.googleScriptUrl, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(payload),
          });
          const responseData = await res.json();

          if (!responseData.success) {
            msg.textContent = responseData.message || "Ошибка розыгрыша";
            msg.className = "message error";
          } else {
            const winner = responseData.winner;
            showWinnerMessage(winner);

            // Обновляем списки
            await loadAdminData();
            await loadWinners();
          }
        } catch (e) {
          msg.textContent = "Ошибка соединения. Попробуйте позже.";
          msg.className = "message error";
        } finally {
          btn.disabled = false;
        }
        return;
      }

      // Доступные участники (не выигрывавшие ранее) - ДЕМО РЕЖИМ
      const eligible = participants.filter((p) => !p.won);

      if (eligible.length === 0) {
        msg.textContent =
          "Нет доступных участников для розыгрыша (все уже выиграли или участников 0).";
        msg.className = "message error";
        return;
      }

      btn.disabled = true;
      msg.className = "message";
      let count = 0;

      // Визуальная анимация выбора ("барабан")
      let interval = setInterval(() => {
        let rand = eligible[Math.floor(Math.random() * eligible.length)];
        msg.textContent = "Вращение барабана... " + rand.receipt;
        count++;
        if (count > 15) {
          clearInterval(interval);
          finishDraw();
        }
      }, 80);

      function finishDraw() {
        // Выбираем настоящего победителя
        const winnerIndex = Math.floor(Math.random() * eligible.length);
        const winner = eligible[winnerIndex];

        // В демо-режиме: Обновляем локальные данные
        winner.won = true;
        const winRecord = {
          receipt: winner.receipt,
          name: winner.name,
          phone: winner.phone,
          date: new Date().toLocaleDateString(),
        };
        winners.push(winRecord);

        /*
              В боевом режиме здесь необходимо сделать POST-запрос на GAS с action="saveWinner",
              чтобы сохранить запись в лист "Победители".
            */

        showWinnerMessage(winner);
        btn.disabled = false;

        // Обновляем статистику
        renderAdminStats();

        // Перерисовываем таблицу с учетом текущего статуса поиска
        const q = document.getElementById("searchInput").value.toLowerCase();
        if (q) {
          document
            .getElementById("searchInput")
            .dispatchEvent(new Event("input"));
        } else {
          renderParticipants(participants);
        }
      }
    });

  // ---- ЛОГИКА ВКЛАДОК ПАНЕЛИ АДМИНИСТРАТОРА ----
  const tabParticipants = document.getElementById("tabParticipants");
  const tabSettings = document.getElementById("tabSettings");
  const participantsTabContent = document.getElementById("participantsTabContent");
  const settingsTabContent = document.getElementById("settingsTabContent");

  function fillSettingsInputs() {
    const startInput = document.getElementById("adminStartDate");
    const endInput = document.getElementById("adminEndDate");
    const drawInput = document.getElementById("adminDrawDate");

    if (startInput && config.startDate) {
      startInput.value = formatDateTimeLocal(config.startDate);
    }
    if (endInput && config.endDate) {
      endInput.value = formatDateTimeLocal(config.endDate);
    }
    if (drawInput && config.drawDate) {
      drawInput.value = formatDateTimeLocal(config.drawDate);
    }

    updateRegistrationStatusUI();
  }

  function updateRegistrationStatusUI() {
    const statusText = document.getElementById("adminRegStatusText");
    const toggleBtn = document.getElementById("toggleRegBtn");
    if (!statusText || !toggleBtn) return;

    const isEnabled = config.registrationEnabled !== false;
    if (isEnabled) {
      statusText.textContent = "🟢 Открыта";
      statusText.style.backgroundColor = "rgba(46, 204, 113, 0.2)";
      statusText.style.color = "var(--primary, #2ecc71)";
      toggleBtn.textContent = "🔴 Закрыть регистрацию";
      toggleBtn.className = "btn btn-outline";
      toggleBtn.style.color = "var(--error, #cf6679)";
      toggleBtn.style.borderColor = "var(--error, #cf6679)";
    } else {
      statusText.textContent = "🔴 Закрыта";
      statusText.style.backgroundColor = "rgba(207, 102, 121, 0.2)";
      statusText.style.color = "var(--error, #cf6679)";
      toggleBtn.textContent = "🟢 Открыть регистрацию";
      toggleBtn.className = "btn btn-outline";
      toggleBtn.style.color = "var(--primary, #00a658)";
      toggleBtn.style.borderColor = "var(--primary, #00a658)";
    }
  }

  function formatDateTimeLocal(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const pad = (num) => String(num).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function parseUserDate(str) {
    if (!str) return null;
    str = str.trim();
    
    // Check if it's already in YYYY-MM-DDTHH:mm:ss format
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(str)) {
      const d = new Date(str.replace(' ', 'T'));
      if (!isNaN(d.getTime())) return str.replace(' ', 'T');
    }
    
    // Check for DD.MM.YYYY HH:mm:ss or DD.MM.YYYY HH:mm or DD.MM.YYYY
    let match = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const year = parseInt(match[3], 10);
      const hour = match[4] ? parseInt(match[4], 10) : 0;
      const min = match[5] ? parseInt(match[5], 10) : 0;
      const sec = match[6] ? parseInt(match[6], 10) : 0;
      const date = new Date(year, month, day, hour, min, sec);
      if (!isNaN(date.getTime())) {
        const pad = (num) => String(num).padStart(2, '0');
        return `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(min)}:${pad(sec)}`;
      }
    }
    
    const fallback = new Date(str);
    if (!isNaN(fallback.getTime())) {
      return fallback.toISOString();
    }
    return null;
  }

  if (tabParticipants && tabSettings) {
    tabParticipants.addEventListener("click", () => {
      tabParticipants.classList.add("active");
      tabParticipants.style.color = "var(--primary)";
      tabParticipants.style.borderBottom = "3px solid var(--primary)";
      
      tabSettings.classList.remove("active");
      tabSettings.style.color = "var(--text-muted)";
      tabSettings.style.borderBottom = "none";

      participantsTabContent.classList.remove("hidden");
      settingsTabContent.classList.add("hidden");
    });

    tabSettings.addEventListener("click", () => {
      tabSettings.classList.add("active");
      tabSettings.style.color = "var(--primary)";
      tabSettings.style.borderBottom = "3px solid var(--primary)";
      
      tabParticipants.classList.remove("active");
      tabParticipants.style.color = "var(--text-muted)";
      tabParticipants.style.borderBottom = "none";

      participantsTabContent.classList.add("hidden");
      settingsTabContent.classList.remove("hidden");

      fillSettingsInputs();
    });
  }

  // Принудительное изменение статуса кнопкой
  const toggleRegBtn = document.getElementById("toggleRegBtn");
  if (toggleRegBtn) {
    toggleRegBtn.addEventListener("click", () => {
      config.registrationEnabled = config.registrationEnabled === false ? true : false;
      updateRegistrationStatusUI();
    });
  }

  // Сохранение настроек
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", async () => {
      const msg = document.getElementById("settingsMessage");
      const startVal = document.getElementById("adminStartDate").value;
      const endVal = document.getElementById("adminEndDate").value;
      const drawVal = document.getElementById("adminDrawDate").value;

      if (!startVal || !endVal || !drawVal) {
        msg.textContent = "Пожалуйста, заполните все обязательные поля.";
        msg.className = "message error";
        return;
      }

      const parsedStart = parseUserDate(startVal);
      const parsedEnd = parseUserDate(endVal);
      const parsedDraw = parseUserDate(drawVal);

      if (!parsedStart || !parsedEnd || !parsedDraw) {
        msg.textContent = "Неверный формат даты. Пожалуйста, используйте формат: ДД.ММ.ГГГГ ЧЧ:ММ (например: 30.06.2026 23:59)";
        msg.className = "message error";
        return;
      }

      saveSettingsBtn.disabled = true;
      saveSettingsBtn.textContent = "Сохранение...";
      msg.textContent = "";
      msg.className = "message";

      const newSettings = {
        startDate: parsedStart,
        endDate: parsedEnd,
        drawDate: parsedDraw,
        registrationEnabled: config.registrationEnabled !== false
      };

      try {
        if (useMock) {
          await new Promise((r) => setTimeout(r, 600));
          localStorage.setItem("lottery_settings", JSON.stringify(newSettings));
          config = { ...config, ...newSettings };
          msg.textContent = "Настройки успешно сохранены (демо-режим).";
          msg.className = "message success";
          checkRegistrationPeriod();
          fillSettingsInputs(); // Re-format beautifully
        } else {
          const payload = {
            action: "saveSettings",
            token: adminToken,
            ...newSettings
          };

          const res = await fetch(config.googleScriptUrl, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(payload)
          });

          const json = await res.json();
          if (json.success) {
            config = { ...config, ...newSettings };
            msg.textContent = json.message || "Настройки успешно сохранены.";
            msg.className = "message success";
            checkRegistrationPeriod();
            fillSettingsInputs(); // Re-format beautifully
          } else {
            msg.textContent = json.message || "Не удалось сохранить настройки.";
            msg.className = "message error";
          }
        }
      } catch (err) {
        console.error("Ошибка при сохранении настроек:", err);
        msg.textContent = "Произошла ошибка связи с сервером.";
        msg.className = "message error";
      } finally {
        saveSettingsBtn.disabled = false;
        saveSettingsBtn.textContent = "Сохранить настройки";
      }
    });
  }

  // Первоначальный вызов отрисовки открытой части
  loadWinners();
});
