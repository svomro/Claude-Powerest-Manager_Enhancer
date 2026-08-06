// ==UserScript==
// @name         Claude model alias menu test
// @namespace    codex-local
// @version      0.7.2
// @description  Adds manual model id rows under Claude's More models submenu.
// @match        https://claude.ai/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  /*
   * This script does not bypass model access.
   * Each alias is a manual model id. Claude's backend still decides whether it is allowed.
   */
  const MODEL_ALIASES = [
    {
      label: "Opus 4.5",
      description: "Uses claude-opus-4-5",
      modelId: "claude-opus-4-5-20251101",
      thinkingMode: "extended",
      showAliasOnButton: true,
    },
    {
      label: "Opus 4.1",
      description: "Uses opus-4-1",
      modelId: "claude-opus-4-1-20250805-claude-ai",
      thinkingMode: "extended",
      showAliasOnButton: true,
    },
    {
      label: "Sonnet 4.5",
      description: "Uses sonnet-4-5",
      modelId: "claude-sonnet-4-5-20250929",
      thinkingMode: "extended",
      showAliasOnButton: true,
    },
    {
      label: "Sonnet 4",
      description: "Uses sonnet-4",
      modelId: "claude-sonnet-4-20250514",
      thinkingMode: "extended",
      showAliasOnButton: true,
    }
  ];

  const ALIAS_ATTR = "data-codex-model-alias";
  const ALIAS_CHECK_ATTR = "data-codex-model-alias-check";
  const HIDDEN_NATIVE_CHECK_ATTR = "data-codex-hidden-native-check";
  const SCRIPT_VERSION = "0.7.2";
  let selectedAlias = null;
  let rewriteAlias = null;
  let rafId = 0;

  function textOf(node) {
    return (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isNewChatPage() {
    return location.pathname === "/new" || location.pathname === "/";
  }

  function getModelTrigger() {
    return document.querySelector('[data-testid="model-selector-dropdown"]');
  }

  function asElement(target) {
    if (target instanceof Element) return target;
    return target?.parentElement || null;
  }

  function getLabelContainer(trigger) {
    return trigger?.querySelector(".overflow-x-clip") || null;
  }

  function getTrailingNode(item) {
    return item.querySelector(".ml-md") || item.lastElementChild;
  }

  function getMenuItemLabel(item) {
    const labelNode = item?.querySelector?.(".font-ui");
    const label = labelNode?.textContent?.trim();
    if (label) return label;

    const match = textOf(item).match(/\b(?:Opus|Sonnet|Haiku)\s+\d+(?:\.\d+)?\b/);
    return match?.[0] || "";
  }

  function getCurrentEffortLabel() {
    for (const menu of getOpenModelMenus()) {
      const effortItem = [...menu.querySelectorAll('[role="menuitem"]')].find((item) =>
        /^Effort\b/.test(textOf(item)),
      );
      const match = textOf(effortItem).match(/\b(Max|Extended|Adaptive)\b/);
      if (match) return match[1];
    }
    return "";
  }

  function isTopLevelModelItem(item) {
    const menu = item?.closest?.('[role="menu"]');
    if (!menu) return false;
    return [...menu.querySelectorAll('[role="menuitem"]')].some((child) => /More models|Effort/.test(textOf(child)));
  }

  function setTriggerLabel(modelLabel, thinkingLabel) {
    if (!modelLabel) return;
    const trigger = getModelTrigger();
    const labelContainer = getLabelContainer(trigger);
    if (!trigger || !labelContainer) return;

    const buttonText = [modelLabel, thinkingLabel].filter(Boolean).join(" ");
    if (textOf(labelContainer) === buttonText) return;

    labelContainer.textContent = "";
    labelContainer.append(document.createTextNode(modelLabel));

    if (thinkingLabel) {
      const suffix = document.createElement("span");
      suffix.className = "ml-1 text-text-500";
      suffix.textContent = ` ${thinkingLabel}`;
      labelContainer.append(suffix);
    }

    trigger.setAttribute("aria-label", `Model: ${buttonText}`);
  }

  function restoreMenuCheckVisibility() {
    for (const item of document.querySelectorAll(`[${HIDDEN_NATIVE_CHECK_ATTR}]`)) {
      const trailing = getTrailingNode(item);
      if (trailing) trailing.style.visibility = "";
      item.removeAttribute(HIDDEN_NATIVE_CHECK_ATTR);
    }
    for (const check of document.querySelectorAll(`[${ALIAS_CHECK_ATTR}]`)) {
      check.remove();
    }
  }

  function getNativeCheckTemplate() {
    for (const menu of getOpenModelMenus()) {
      for (const item of menu.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')) {
        if (item.hasAttribute(ALIAS_ATTR)) continue;
        const trailing = getTrailingNode(item);
        if (trailing && (trailing.childNodes.length || textOf(trailing))) {
          const wrapper = document.createElement("span");
          wrapper.append(...[...trailing.childNodes].map((child) => child.cloneNode(true)));
          return wrapper;
        }
      }
    }
    return null;
  }

  function clearSelectedAlias() {
    selectedAlias = null;
    rewriteAlias = null;
    restoreMenuCheckVisibility();
  }

  function getThinkingLabel(alias) {
    if (alias.thinkingLabel) return alias.thinkingLabel;
    if (alias.thinkingMode === "extended") return "Extended";
    if (alias.thinkingMode === "auto") return "Adaptive";
    return "";
  }

  function getAliasButtonText(alias) {
    return [alias.label, getThinkingLabel(alias)].filter(Boolean).join(" ");
  }

  function getTriggerModelLabel() {
    const label = textOf(getLabelContainer(getModelTrigger()));
    return label.replace(/\s+\b(?:Max|Extended|Adaptive)\b$/, "").trim();
  }

  function findAliasByLabel(label) {
    return MODEL_ALIASES.find((alias) => alias.label === label) || null;
  }

  function findNativeModelItemForAlias(alias) {
    if (!alias) return null;
    for (const menu of getOpenModelMenus()) {
      for (const item of menu.querySelectorAll('[role="menuitemradio"]')) {
        if (item.hasAttribute(ALIAS_ATTR)) continue;
        if (getMenuItemLabel(item) === alias.label) return item;
      }
    }
    return null;
  }

  function isAliasNativeVisible(alias) {
    return Boolean(findNativeModelItemForAlias(alias));
  }

  function rememberAliasFromTrigger() {
    if (selectedAlias || rewriteAlias) return;
    const alias = findAliasByLabel(getTriggerModelLabel());
    if (!alias) return;
    if (isAliasNativeVisible(alias)) return;
    selectedAlias = alias.showAliasOnButton ? alias : null;
  }

  function getOrganizationUuid() {
    const fromPerformance = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .join("\n")
      .match(/\/api\/organizations\/([0-9a-f-]{36})\//i);
    if (fromPerformance) return fromPerformance[1];

    const fromHtml = document.documentElement.innerHTML.match(/\/api\/organizations\/([0-9a-f-]{36})\//i);
    return fromHtml?.[1] || "";
  }

  async function requestModelConfig(alias) {
    const organizationUuid = getOrganizationUuid();
    if (!organizationUuid || !alias.modelId) {
      console.warn("[Claude model alias] Cannot request model config; missing organization uuid or model id.");
      return;
    }

    try {
      await fetch(`/api/organizations/${organizationUuid}/model_configs/${encodeURIComponent(alias.modelId)}`, {
        credentials: "include",
      });
    } catch (error) {
      console.warn("[Claude model alias] model config request failed:", error);
    }
  }

  function closeMenus() {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  function installRequestRewriter() {
    if (window.__codexClaudeModelAliasRewriterInstalled) {
      if (window.__codexClaudeModelAliasRewriterInstalled !== SCRIPT_VERSION) {
        console.warn("[Claude model alias] A previous request rewriter is still active. Hard refresh this Claude tab after saving the script.");
      }
      return;
    }
    window.__codexClaudeModelAliasRewriterInstalled = SCRIPT_VERSION;

    function targetModelId() {
      if (getOpenModelMenus().length) return "";
      return rewriteAlias?.modelId || "";
    }

    // Thinking mode only for our fake models
    function targetThinkingMode() {
      if (getOpenModelMenus().length) return "";
      return rewriteAlias?.thinkingMode || "";
    }

    function rewriteUrl(url) {
      return url;
    }

    function rewriteJsonValue(value) {
      const modelId = targetModelId();
      const thinkingMode = targetThinkingMode();
      if (!modelId || value == null) return value;
      if (Array.isArray(value)) return value.map(rewriteJsonValue);
      if (typeof value !== "object") return value;

      const out = {};
      for (const [key, child] of Object.entries(value)) {
        if (
          typeof child === "string" &&
          /^(model|modelOverride|initialModel|contextModel)$/i.test(key) &&
          child.startsWith("claude-")
        ) {
          out[key] = modelId;
        } else if (
          thinkingMode &&
          /^(paprika_mode|thinkingModeOverride|thinking_mode)$/i.test(key)
        ) {
          out[key] = thinkingMode;
        } else {
          out[key] = rewriteJsonValue(child);
        }
      }

      return out;
    }

    function rewriteBody(body) {
      if (!targetModelId() || typeof body !== "string") return body;
      if (
        !body.includes("claude-") &&
        !body.includes("model") &&
        !body.includes("paprika") &&
        !body.includes("thinking")
      ) {
        return body;
      }

      console.log("[Claude model alias] Intercepted body before rewrite:", body);
      let nextBody;
      try {
        nextBody = JSON.stringify(rewriteJsonValue(JSON.parse(body)));
      } catch {
        nextBody = body.replace(/"((?:model|modelOverride|initialModel|contextModel))"\s*:\s*"claude-[^"]+"/gi, (_m, key) => {
          return `"${key}":"${targetModelId()}"`;
        });
        const thinkingMode = targetThinkingMode();
        if (thinkingMode) {
          nextBody = nextBody.replace(/"((?:paprika_mode|thinkingModeOverride|thinking_mode))"\s*:\s*(?:"[^"]*"|null)/gi, (_m, key) => {
            return `"${key}":"${thinkingMode}"`;
          });
        }
      }
      console.log("[Claude model alias] Rewritten body:", nextBody);
      return nextBody;
    }

    if (typeof window.fetch === "function") {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = function codexModelAliasFetch(input, init) {
        const nextInit = init ? { ...init } : init;
        if (nextInit && "body" in nextInit) nextInit.body = rewriteBody(nextInit.body);

        if (typeof input === "string") {
          return nativeFetch(rewriteUrl(input), nextInit);
        }
        if (input instanceof URL) {
          return nativeFetch(rewriteUrl(input.toString()), nextInit);
        }
        if (input instanceof Request) {
          const nextUrl = rewriteUrl(input.url);
          if (nextUrl !== input.url) return nativeFetch(nextUrl, nextInit || input);
        }
        return nativeFetch(input, nextInit);
      };
    }

    if (typeof window.XMLHttpRequest === "function") {
      const nativeOpen = window.XMLHttpRequest.prototype.open;
      const nativeSend = window.XMLHttpRequest.prototype.send;

      window.XMLHttpRequest.prototype.open = function codexModelAliasOpen(method, url, ...rest) {
        return nativeOpen.call(this, method, rewriteUrl(url), ...rest);
      };

      window.XMLHttpRequest.prototype.send = function codexModelAliasSend(body) {
        return nativeSend.call(this, rewriteBody(body));
      };
    }
  }

  function getOpenModelMenus() {
    if (!isNewChatPage()) return [];
    return [...document.querySelectorAll('[role="menu"]')].filter((menu) => {
      const text = textOf(menu);
      return /Opus|Sonnet|Haiku|More models/.test(text);
    });
  }

  function isMoreModelsSubmenu(menu) {
    const hasNestedMenuTrigger = [...menu.querySelectorAll('[role="menuitem"]')].some((item) =>
      /More models|Effort/.test(textOf(item)),
    );
    const modelLabels = [...menu.querySelectorAll('[role="menuitemradio"]')]
      .map((item) => item.querySelector(".font-ui")?.textContent?.trim())
      .filter(Boolean);

    return !hasNestedMenuTrigger && modelLabels.some((label) => /Opus|Sonnet|Haiku/.test(label));
  }

  function cloneAliasItem(template, alias) {
    const clone = template.cloneNode(true);
    clone.removeAttribute("id");
    clone.setAttribute(ALIAS_ATTR, alias.label);
    clone.setAttribute("aria-checked", "false");
    clone.removeAttribute("data-highlighted");
    clone.removeAttribute("data-disabled");
    clone.style.cursor = "pointer";

    const labelNode = clone.querySelector(".font-ui");
    if (labelNode) labelNode.textContent = alias.label;

    const descriptionNode = clone.querySelector(".text-footnote, .text-muted");
    if (descriptionNode) descriptionNode.textContent = alias.description || "";

    const trailing = clone.querySelector(".ml-md");
    if (trailing) trailing.textContent = "";

    const choose = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      const nativeItem = findNativeModelItemForAlias(alias);
      if (nativeItem) {
        clearSelectedAlias();
        nativeItem.click();
        return;
      }

      restoreMenuCheckVisibility();
      selectedAlias = alias.showAliasOnButton ? alias : null;
      rewriteAlias = alias;
      requestModelConfig(alias);
      closeMenus();
      scheduleAliasTriggerRefresh(alias);
    };

    clone.addEventListener(
      "pointerdown",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
      },
      true,
    );
    clone.addEventListener(
      "click",
      choose,
      true,
    );

    return clone;
  }

  function injectAliases() {
    if (!isNewChatPage()) return;
    for (const menu of getOpenModelMenus()) {
      if (!isMoreModelsSubmenu(menu)) continue;
      for (const item of menu.querySelectorAll(`[${ALIAS_ATTR}]`)) {
        const alias = findAliasByLabel(item.getAttribute(ALIAS_ATTR));
        if (isAliasNativeVisible(alias)) item.remove();
      }
      if (menu.querySelector(`[${ALIAS_ATTR}]`)) continue;

      const group = menu.querySelector('[role="group"]') || menu.firstElementChild;
      const template = [...menu.querySelectorAll('[role="menuitemradio"]')].find(
        (item) => !item.hasAttribute(ALIAS_ATTR),
      );
      if (!group || !template) continue;

      const aliasesToInject = MODEL_ALIASES.filter((alias) => !isAliasNativeVisible(alias));
      for (const alias of aliasesToInject) {
        group.appendChild(cloneAliasItem(template, alias));
      }
    }
  }

  function setAliasCheck(item, checked, nativeCheckTemplate) {
    item.setAttribute("aria-checked", checked ? "true" : "false");

    const existingCheck = item.querySelector(`[${ALIAS_CHECK_ATTR}]`);
    if (!checked) {
      existingCheck?.remove();
      return;
    }

    if (existingCheck) return;
    const trailing = getTrailingNode(item);
    if (!trailing) return;

    const check = nativeCheckTemplate?.cloneNode(true);
    if (!check) return;
    check.setAttribute(ALIAS_CHECK_ATTR, "true");
    trailing.textContent = "";
    trailing.append(check);
  }

  function setNativeCheckHidden(item, hidden) {
    const trailing = getTrailingNode(item);
    if (!trailing) return;

    if (hidden) {
      item.setAttribute(HIDDEN_NATIVE_CHECK_ATTR, "true");
      trailing.style.visibility = "hidden";
      return;
    }

    if (item.hasAttribute(HIDDEN_NATIVE_CHECK_ATTR)) {
      trailing.style.visibility = "";
      item.removeAttribute(HIDDEN_NATIVE_CHECK_ATTR);
    }
  }

  function syncAliasMenuCheckedState() {
    rememberAliasFromTrigger();

    if (!selectedAlias) {
      restoreMenuCheckVisibility();
      return;
    }

    if (isAliasNativeVisible(selectedAlias)) {
      clearSelectedAlias();
      return;
    }

    const nativeCheckTemplate = getNativeCheckTemplate();
    for (const menu of getOpenModelMenus()) {
      for (const item of menu.querySelectorAll('[role="menuitemradio"]')) {
        const isAlias = item.hasAttribute(ALIAS_ATTR);
        const isSelectedAlias = item.getAttribute(ALIAS_ATTR) === selectedAlias.label;
        if (isAlias) {
          setAliasCheck(item, isSelectedAlias, nativeCheckTemplate);
        } else {
          setNativeCheckHidden(item, true);
        }
      }
    }
  }

  function updateTriggerLabel() {
    if (!isNewChatPage()) return;
    if (!selectedAlias) return;
    setTriggerLabel(selectedAlias.label, getThinkingLabel(selectedAlias));
  }

  function scheduleAliasTriggerRefresh(alias) {
    const delays = [0, 50, 150, 400, 900, 1500];
    for (const delay of delays) {
      window.setTimeout(() => {
        if (selectedAlias !== alias) return;
        setTriggerLabel(alias.label, getThinkingLabel(alias));
      }, delay);
    }
  }

  function scheduleInject() {
    if (rafId) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      injectAliases();
      syncAliasMenuCheckedState();
      updateTriggerLabel();
    });
  }

  const observer = new MutationObserver(() => {
    scheduleInject();
  });

  function getNativeModelItemFromTarget(target) {
    rememberAliasFromTrigger();
    if (!selectedAlias && !rewriteAlias) return null;
    if (asElement(target)?.closest?.(`[${ALIAS_ATTR}]`)) return null;

    const element = asElement(target);
    if (!element) return null;

    const item = element.closest('[role="menuitemradio"]');
    const menu = item?.closest?.('[role="menu"]');
    if (!item || !menu) return null;

    return /Opus|Sonnet|Haiku/.test(textOf(item)) ? item : null;
  }

  function switchBackToNativeModel(item) {
    clearSelectedAlias();
  }

  function clearAliasBeforeNativeModelEvent(event) {
    const item = getNativeModelItemFromTarget(event.target);
    if (item) switchBackToNativeModel(item);
  }

  function clearAliasBeforeNativeModelKey(event) {
    if (!selectedAlias && !rewriteAlias) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    const item = getNativeModelItemFromTarget(document.activeElement);
    if (item) switchBackToNativeModel(item);
  }

  function start() {
    installRequestRewriter();

    for (const eventName of ["pointerdown", "mousedown", "touchstart", "click"]) {
      window.addEventListener(eventName, clearAliasBeforeNativeModelEvent, true);
      document.addEventListener(eventName, clearAliasBeforeNativeModelEvent, true);
    }

    window.addEventListener("keydown", clearAliasBeforeNativeModelKey, true);
    document.addEventListener("keydown", clearAliasBeforeNativeModelKey, true);

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    scheduleInject();
  }

  if (document.documentElement) {
    start();
  } else {
    window.addEventListener("DOMContentLoaded", start, { once: true });
  }
})();
