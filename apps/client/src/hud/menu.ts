type Screen = "main" | "pause" | "none";
type Action = "singlePlayer" | "multiplayer" | "resume" | "restart" | "quit";
type Actions = Record<Action, () => void>;

export function mountMenu(root: HTMLElement, actions: Actions) {
  const document = root.ownerDocument;
  const dialog = document.createElement("dialog");
  root.append(dialog);
  let screen: Screen = "none";

  function activate(action: Action): void {
    show(action === "quit" ? "main" : "none");
    actions[action]();
  }

  function show(next: Screen): void {
    if (!(["main", "pause", "none"] as const).includes(next)) {
      throw new RangeError("Unknown menu screen");
    }
    dialog.close();
    dialog.replaceChildren();
    screen = next;
    if (next === "none") {
      return;
    }
    const title = document.createElement("h2");
    title.textContent = next === "main" ? "Main menu" : "Paused";
    dialog.setAttribute("aria-label", title.textContent);
    dialog.append(title);
    const buttons: [string, Action][] =
      next === "main"
        ? [
            ["Single player", "singlePlayer"],
            ["Multiplayer", "multiplayer"],
          ]
        : [
            ["Resume", "resume"],
            ["Restart", "restart"],
            ["Quit to menu", "quit"],
          ];
    for (const [label, action] of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => {
        activate(action);
      });
      dialog.append(button);
    }
    dialog.showModal();
    dialog.querySelector("button")?.focus();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.repeat) {
      return;
    }
    event.preventDefault();
    if (screen === "pause") {
      activate("resume");
    } else if (screen === "none") {
      show("pause");
    }
  }

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
  });
  document.addEventListener("keydown", onKeyDown);
  return {
    show,
    get screen() {
      return screen;
    },
    destroy() {
      document.removeEventListener("keydown", onKeyDown);
      dialog.close();
      dialog.remove();
    },
  };
}
