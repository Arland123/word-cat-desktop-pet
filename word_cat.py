import json
import math
import random
import sys
import tkinter as tk
from datetime import date, datetime, timedelta
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR / "data"
DATA_FILE = DATA_DIR / "state.json"

BLUE = "#23477a"
SKY = "#e9f1fd"
LINE = "#d8e3f4"
GREEN = "#59b98a"
RED = "#bd3a3a"
TRANSPARENT = "#123456"

DEFAULT_STATE = {
    "settings": {
        "interval_minutes": 45,
        "daily_goal": 20,
        "reminder_start": "08:00",
        "reminder_end": "23:00",
        "sound": True,
    },
    "words": [],
    "records": {},
}


def load_state():
    DATA_DIR.mkdir(exist_ok=True)
    if not DATA_FILE.exists():
        save_state(DEFAULT_STATE)
    try:
        loaded = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        state = {**DEFAULT_STATE, **loaded}
        state["settings"] = {**DEFAULT_STATE["settings"], **state.get("settings", {})}
        return state
    except (OSError, json.JSONDecodeError):
        return json.loads(json.dumps(DEFAULT_STATE))


def save_state(state):
    DATA_DIR.mkdir(exist_ok=True)
    DATA_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def date_key(value=None):
    return (value or date.today()).isoformat()


def key_offset(offset):
    return date_key(date.today() - timedelta(days=offset))


def beep():
    try:
        import winsound
        winsound.MessageBeep(winsound.MB_ICONASTERISK)
    except Exception:
        pass


def in_reminder_window(settings):
    now = datetime.now()
    minute = now.hour * 60 + now.minute
    start = [int(v) for v in settings["reminder_start"].split(":")]
    end = [int(v) for v in settings["reminder_end"].split(":")]
    return start[0] * 60 + start[1] <= minute <= end[0] * 60 + end[1]


class PetWindow(tk.Toplevel):
    def __init__(self, master, app):
        super().__init__(master, bg=TRANSPARENT)
        self.app = app
        self.overrideredirect(True)
        self.attributes("-topmost", True)
        self.attributes("-transparentcolor", TRANSPARENT)
        self.geometry("260x280+80+80")
        self.canvas = tk.Canvas(self, width=260, height=280, bg=TRANSPARENT, highlightthickness=0)
        self.canvas.pack()
        self.canvas.bind("<ButtonPress-1>", self.start_move)
        self.canvas.bind("<B1-Motion>", self.do_move)
        self.canvas.tag_bind("panel", "<Button-1>", lambda e: self.app.show_panel())
        self.bubble_id = None
        self.bubble_box = None
        self.cat_items = []
        self.frame = 0
        self.draw_cat()
        self.animate()
        self.show_bubble("喵，今天也要加油！", "happy")

    def start_move(self, event):
        self._x = event.x
        self._y = event.y

    def do_move(self, event):
        self.geometry(f"+{event.x_root - self._x}+{event.y_root - self._y}")

    def draw_cat(self, tail_phase=0):
        for item in self.cat_items:
            self.canvas.delete(item)
        self.cat_items.clear()
        c = self.canvas
        tail_y = 175 + math.sin(tail_phase) * 14
        self.cat_items.append(c.create_line(
            185, 180, 214, tail_y, 202, tail_y - 38,
            smooth=True, width=10, capstyle="round", fill=BLUE
        ))
        self.cat_items.append(c.create_polygon(
            38, 148, 25, 55, 96, 92, 164, 92, 235, 55, 222, 148,
            fill="white", outline=BLUE, width=8, joinstyle="round", smooth=True
        ))
        self.cat_items.append(c.create_oval(
            42, 88, 218, 232, fill="white", outline=BLUE, width=8
        ))
        self.cat_items.append(c.create_line(52, 118, 75, 111, fill=BLUE, width=5, capstyle="round"))
        self.cat_items.append(c.create_line(208, 118, 185, 111, fill=BLUE, width=5, capstyle="round"))
        self.cat_items.append(c.create_arc(76, 130, 116, 168, start=190, extent=160, style="arc", outline=BLUE, width=8))
        self.cat_items.append(c.create_arc(144, 130, 184, 168, start=190, extent=160, style="arc", outline=BLUE, width=8))
        self.cat_items.append(c.create_line(122, 158, 138, 158, fill=BLUE, width=6, capstyle="round"))
        self.cat_items.append(c.create_line(96, 196, 96, 221, fill=BLUE, width=6, capstyle="round"))
        self.cat_items.append(c.create_line(164, 196, 164, 221, fill=BLUE, width=6, capstyle="round"))
        self.cat_items.append(c.create_rectangle(
            82, 244, 178, 270, fill=BLUE, outline="", tags="panel"
        ))
        self.cat_items.append(c.create_text(
            130, 257, text="打开面板", fill="white", font=("Microsoft YaHei UI", 10, "bold"), tags="panel"
        ))

    def animate(self):
        self.frame += 1
        self.draw_cat(self.frame / 12)
        lift = math.sin(self.frame / 20) * 2
        for item in self.cat_items[1:9]:
            try:
                self.canvas.move(item, 0, 0)
            except tk.TclError:
                pass
        self.after(50, self.animate)

    def show_bubble(self, text, mood="remind"):
        if self.bubble_id:
            self.canvas.delete(self.bubble_id)
            self.bubble_id = None
        if self.bubble_box:
            self.canvas.delete(self.bubble_box)
            self.bubble_box = None
        self.bubble_box = self.canvas.create_rectangle(
            22, 4, 238, 42, fill="white", outline=BLUE, width=3
        )
        self.bubble_id = self.canvas.create_text(
            130, 23, text=text, fill=BLUE, font=("Microsoft YaHei UI", 11, "bold"), width=195
        )
        if mood == "remind":
            self.after(4500, self.clear_bubble)
        else:
            self.after(3500, self.clear_bubble)

    def clear_bubble(self):
        if self.bubble_id:
            self.canvas.delete(self.bubble_id)
            self.bubble_id = None
        if self.bubble_box:
            self.canvas.delete(self.bubble_box)
            self.bubble_box = None


class WordCatApp:
    def __init__(self, root):
        self.root = root
        self.root.title("单词猫咪")
        self.root.geometry("1x1+0+0")
        self.state = load_state()
        self.last_remind = datetime.now().timestamp()
        self.selected_words = []
        self.check_vars = {}
        self.pet = PetWindow(root, self)
        self.panel = None
        self.build_panel()
        self.schedule_tick()

    def today_records(self):
        return self.state["records"].setdefault(date_key(), [])

    def today_count(self):
        selection = set(self.today_records())
        return len([w for w in self.selected_words if w["id"] in selection])

    def streak(self):
        streak = 0
        goal = self.state["settings"]["daily_goal"]
        for offset in range(3650):
            records = self.state["records"].get(key_offset(offset), [])
            if len(records) >= goal:
                streak += 1
            elif offset == 0:
                continue
            else:
                break
        return streak

    def show_panel(self):
        if self.panel:
            self.panel.deiconify()
            self.panel.lift()
            self.panel.focus_force()
            return

    def build_panel(self):
        self.panel = tk.Toplevel(self.root)
        self.panel.title("单词猫咪 · 打卡面板")
        self.panel.geometry("900x640")
        self.panel.configure(bg="#f2f6fd")
        self.panel.protocol("WM_DELETE_WINDOW", self.hide_panel)
        self.panel.columnconfigure(0, weight=1)
        self.panel.rowconfigure(2, weight=1)

        header = tk.Frame(self.panel, bg="#f2f6fd")
        header.grid(row=0, column=0, sticky="ew", padx=18, pady=(16, 8))
        header.columnconfigure(0, weight=1)
        tk.Label(header, text="单词猫咪", font=("Microsoft YaHei UI", 22, "bold"), bg="#f2f6fd", fg=BLUE).grid(row=0, column=0, sticky="w")
        self.streak_label = tk.Label(header, text="", font=("Microsoft YaHei UI", 10), bg="#f2f6fd", fg="#64748b")
        self.streak_label.grid(row=1, column=0, sticky="w")
        tk.Button(header, text="退出应用", command=self.quit_app, bg="white", fg=RED, relief="flat", font=("Microsoft YaHei UI", 9, "bold"), padx=12, pady=6).grid(row=0, column=1, rowspan=2, sticky="e")

        stats = tk.Frame(self.panel, bg="#f2f6fd")
        stats.grid(row=1, column=0, sticky="ew", padx=18, pady=8)
        self.stat_values = []
        for index, label in enumerate(["词库总数", "今日打卡", "每日目标", "连续天数"]):
            stats.columnconfigure(index, weight=1, uniform="stat")
            card = tk.Frame(stats, bg="white", highlightbackground=LINE, highlightthickness=1)
            card.grid(row=0, column=index, sticky="ew", padx=5)
            value = tk.Label(card, text="0", font=("Microsoft YaHei UI", 20, "bold"), bg="white", fg=BLUE)
            value.pack(pady=(10, 0))
            tk.Label(card, text=label, font=("Microsoft YaHei UI", 9), bg="white", fg="#71809b").pack(pady=(0, 10))
            self.stat_values.append(value)

        main = tk.Frame(self.panel, bg="#f2f6fd")
        main.grid(row=2, column=0, sticky="nsew", padx=18, pady=8)
        main.columnconfigure(0, weight=3)
        main.columnconfigure(1, weight=2)
        main.rowconfigure(0, weight=1)

        study = self.card(main)
        study.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        study.columnconfigure(0, weight=1)
        study.rowconfigure(2, weight=1)
        study_head = tk.Frame(study, bg="white")
        study_head.grid(row=0, column=0, sticky="ew", padx=14, pady=(12, 6))
        tk.Label(study_head, text="今日学习", font=("Microsoft YaHei UI", 13, "bold"), bg="white", fg=BLUE).pack(side="left")
        tk.Button(study_head, text="抽 10 个词", command=self.pick_words, bg=BLUE, fg="white", relief="flat", font=("Microsoft YaHei UI", 9, "bold"), padx=10, pady=5).pack(side="right")
        tk.Label(study, text="勾选表示完成打卡", font=("Microsoft YaHei UI", 9), bg="white", fg="#71809b").grid(row=1, column=0, sticky="w", padx=14)
        self.study_canvas = tk.Canvas(study, bg="white", highlightthickness=0)
        self.study_scroll = tk.Scrollbar(study, orient="vertical", command=self.study_canvas.yview)
        self.study_canvas.configure(yscrollcommand=self.study_scroll.set)
        self.study_inner = tk.Frame(self.study_canvas, bg="white")
        self.study_canvas.create_window((0, 0), window=self.study_inner, anchor="nw", tags="inner")
        self.study_canvas.grid(row=2, column=0, sticky="nsew", padx=10, pady=(6, 12))
        self.study_scroll.grid(row=2, column=1, sticky="ns")
        self.study_inner.bind("<Configure>", lambda e: self.study_canvas.configure(scrollregion=self.study_canvas.bbox("all")))
        self.study_canvas.bind_all("<MouseWheel>", lambda e: self.study_canvas.yview_scroll(-1 * (e.delta // 120), "units"))

        sidebar = tk.Frame(main, bg="#f2f6fd")
        sidebar.grid(row=0, column=1, sticky="nsew")
        sidebar.columnconfigure(0, weight=1)
        sidebar.rowconfigure(0, weight=3)
        sidebar.rowconfigure(1, weight=2)

        words = self.card(sidebar)
        words.grid(row=0, column=0, sticky="nsew", pady=(0, 8))
        words.columnconfigure(0, weight=1)
        words.rowconfigure(2, weight=1)
        word_head = tk.Frame(words, bg="white")
        word_head.grid(row=0, column=0, sticky="ew", padx=14, pady=(12, 6))
        tk.Label(word_head, text="词库", font=("Microsoft YaHei UI", 13, "bold"), bg="white", fg=BLUE).pack(side="left")
        self.word_count_label = tk.Label(word_head, text="0", font=("Microsoft YaHei UI", 9), bg="white", fg="#71809b")
        self.word_count_label.pack(side="right")
        form = tk.Frame(words, bg="white")
        form.grid(row=1, column=0, sticky="ew", padx=12)
        form.columnconfigure(0, weight=1)
        form.columnconfigure(1, weight=1)
        self.word_entry = tk.Entry(form, font=("Microsoft YaHei UI", 10), relief="solid", highlightthickness=1)
        self.meaning_entry = tk.Entry(form, font=("Microsoft YaHei UI", 10), relief="solid", highlightthickness=1)
        self.word_entry.grid(row=0, column=0, sticky="ew", padx=(2, 4), pady=3)
        self.meaning_entry.grid(row=0, column=1, sticky="ew", padx=(4, 2), pady=3)
        tk.Button(form, text="添加单词", command=self.add_word, bg=BLUE, fg="white", relief="flat", font=("Microsoft YaHei UI", 9, "bold"), pady=5).grid(row=1, column=0, columnspan=2, sticky="ew", pady=4)
        self.word_entry.bind("<Return>", lambda e: self.add_word())
        self.word_list = tk.Frame(words, bg="white")
        self.word_list.grid(row=2, column=0, sticky="nsew", padx=10, pady=(4, 12))

        settings = self.card(sidebar)
        settings.grid(row=1, column=0, sticky="nsew")
        settings.columnconfigure(0, weight=1)
        tk.Label(settings, text="提醒设置", font=("Microsoft YaHei UI", 13, "bold"), bg="white", fg=BLUE).grid(row=0, column=0, sticky="w", padx=14, pady=(12, 6))
        s = self.state["settings"]
        self.interval_var = tk.StringVar(value=str(s["interval_minutes"]))
        self.goal_var = tk.StringVar(value=str(s["daily_goal"]))
        self.start_var = tk.StringVar(value=s["reminder_start"])
        self.end_var = tk.StringVar(value=s["reminder_end"])
        self.sound_var = tk.BooleanVar(value=s["sound"])
        rows = [("提醒间隔（分钟）", self.interval_var), ("每日目标（词）", self.goal_var), ("开始时间", self.start_var), ("结束时间", self.end_var)]
        for index, (label, variable) in enumerate(rows):
            tk.Label(settings, text=label, font=("Microsoft YaHei UI", 9), bg="white", fg="#65758d").grid(row=index + 1, column=0, sticky="w", padx=14, pady=(5, 1))
            tk.Entry(settings, textvariable=variable, font=("Microsoft YaHei UI", 10), relief="solid", highlightthickness=1).grid(row=index + 2, column=0, sticky="ew", padx=12)
        tk.Checkbutton(settings, text="提醒时播放音效", variable=self.sound_var, bg="white", font=("Microsoft YaHei UI", 9)).grid(row=9, column=0, sticky="w", padx=14, pady=8)
        tk.Button(settings, text="保存设置", command=self.save_settings, bg=BLUE, fg="white", relief="flat", font=("Microsoft YaHei UI", 9, "bold"), pady=6).grid(row=10, column=0, sticky="ew", padx=12, pady=(0, 14))

        history = self.card(self.panel)
        history.grid(row=3, column=0, sticky="ew", padx=18, pady=(8, 18))
        history.columnconfigure(0, weight=1)
        tk.Label(history, text="最近 14 天（点击日期补录）", font=("Microsoft YaHei UI", 13, "bold"), bg="white", fg=BLUE).grid(row=0, column=0, sticky="w", padx=14, pady=(12, 8))
        self.history_frame = tk.Frame(history, bg="white")
        self.history_frame.grid(row=1, column=0, sticky="ew", padx=12, pady=(0, 14))
        self.render()

    def card(self, parent):
        frame = tk.Frame(parent, bg="white", highlightbackground=LINE, highlightthickness=1)
        return frame

    def hide_panel(self):
        self.panel.withdraw()

    def quit_app(self):
        self.root.destroy()

    def pick_words(self):
        if not self.state["words"]:
            self.selected_words = []
        else:
            self.selected_words = random.sample(self.state["words"], min(10, len(self.state["words"])))
        self.render()

    def add_word(self):
        word = self.word_entry.get().strip()
        if not word:
            return
        if any(w["word"].lower() == word.lower() for w in self.state["words"]):
            self.word_entry.delete(0, tk.END)
            return
        self.state["words"].append({"id": f"{datetime.now().timestamp()}-{word}", "word": word, "meaning": self.meaning_entry.get().strip()})
        self.word_entry.delete(0, tk.END)
        self.meaning_entry.delete(0, tk.END)
        save_state(self.state)
        self.render()

    def delete_word(self, word_id):
        self.state["words"] = [w for w in self.state["words"] if w["id"] != word_id]
        save_state(self.state)
        self.render()

    def save_settings(self):
        try:
            self.state["settings"].update({
                "interval_minutes": max(1, int(self.interval_var.get())),
                "daily_goal": max(1, int(self.goal_var.get())),
                "reminder_start": self.start_var.get(),
                "reminder_end": self.end_var.get(),
                "sound": self.sound_var.get(),
            })
            save_state(self.state)
        except ValueError:
            pass
        self.render()

    def toggle_word(self, word_id):
        records = self.today_records()
        if word_id in records:
            records.remove(word_id)
        else:
            records.append(word_id)
        save_state(self.state)
        self.render()

    def set_record(self, key):
        current = len(self.state["records"].get(key, []))
        dialog = tk.Toplevel(self.panel)
        dialog.title("补录")
        dialog.geometry("260x140")
        dialog.configure(bg="white")
        dialog.transient(self.panel)
        dialog.grab_set()
        tk.Label(dialog, text=f"{key} 打卡数量", font=("Microsoft YaHei UI", 10, "bold"), bg="white", fg=BLUE).pack(pady=(16, 8))
        var = tk.StringVar(value=str(current))
        entry = tk.Entry(dialog, textvariable=var, font=("Microsoft YaHei UI", 11), justify="center", relief="solid")
        entry.pack()
        entry.select_range(0, tk.END)
        entry.focus()

        def submit(event=None):
            try:
                count = max(0, int(var.get()))
                if count:
                    self.state["records"][key] = [f"manual-{key}-{i}" for i in range(count)]
                else:
                    self.state["records"].pop(key, None)
                save_state(self.state)
            except ValueError:
                pass
            dialog.destroy()
            self.render()

        entry.bind("<Return>", submit)
        tk.Button(dialog, text="保存", command=submit, bg=BLUE, fg="white", relief="flat", font=("Microsoft YaHei UI", 9, "bold"), pady=5).pack(pady=12)

    def render(self):
        if not self.panel or not self.panel.winfo_exists():
            return
        s = self.state["settings"]
        self.stat_values[0].configure(text=len(self.state["words"]))
        self.stat_values[1].configure(text=self.today_count())
        self.stat_values[2].configure(text=s["daily_goal"])
        streak = self.streak()
        self.stat_values[3].configure(text=streak)
        self.streak_label.configure(text=f"已连续打卡 {streak} 天" if streak else "从今天开始连续打卡吧！")
        self.word_count_label.configure(text=len(self.state["words"]))
        for child in self.word_list.winfo_children():
            child.destroy()
        if not self.state["words"]:
            tk.Label(self.word_list, text="暂无单词", bg="white", fg="#8b99af").pack(pady=16)
        for word in self.state["words"]:
            row = tk.Frame(self.word_list, bg="#fbfdff", highlightbackground=LINE, highlightthickness=1)
            row.pack(fill="x", pady=3, ipady=5, ipadx=5)
            row.columnconfigure(0, weight=1)
            text = tk.Frame(row, bg="#fbfdff")
            text.grid(row=0, column=0, sticky="w", padx=8)
            tk.Label(text, text=word["word"], font=("Microsoft YaHei UI", 10, "bold"), bg="#fbfdff", fg=BLUE, anchor="w").pack(fill="x")
            tk.Label(text, text=word["meaning"] or "未填写释义", font=("Microsoft YaHei UI", 8), bg="#fbfdff", fg="#70819c", anchor="w").pack(fill="x")
            tk.Button(row, text="删", command=lambda wid=word["id"]: self.delete_word(wid), bg="#fff1f0", fg=RED, relief="flat", font=("Microsoft YaHei UI", 8, "bold"), width=3).grid(row=0, column=1, padx=6)

        done = set(self.today_records())
        for child in self.study_inner.winfo_children():
            child.destroy()
        self.check_vars.clear()
        if not self.selected_words:
            tk.Label(self.study_inner, text="点「抽 10 个词」开始学习", bg="white", fg="#8b99af").grid(row=0, column=0, pady=30)
        for index, word in enumerate(self.selected_words):
            row = tk.Frame(self.study_inner, bg="#ecf8f1" if word["id"] in done else "#fbfdff", highlightbackground=LINE, highlightthickness=1)
            row.grid(row=index, column=0, sticky="ew", pady=3, padx=2, ipady=6)
            row.columnconfigure(1, weight=1)
            text = tk.Frame(row, bg=row["bg"])
            text.grid(row=0, column=1, sticky="w", padx=8)
            tk.Label(text, text=f"{index + 1}. {word['word']}", font=("Microsoft YaHei UI", 11, "bold"), bg=row["bg"], fg=BLUE, anchor="w").pack(fill="x")
            tk.Label(text, text=word["meaning"] or "完成这个词的打卡", font=("Microsoft YaHei UI", 9), bg=row["bg"], fg="#70819c", anchor="w").pack(fill="x")
            var = tk.BooleanVar(value=word["id"] in done)
            self.check_vars[word["id"]] = var
            tk.Checkbutton(row, variable=var, command=lambda wid=word["id"]: self.toggle_word(wid), bg=row["bg"], activebackground=row["bg"]).grid(row=0, column=0, padx=8)

        for child in self.history_frame.winfo_children():
            child.destroy()
        for i in range(14):
            self.history_frame.columnconfigure(i, weight=1, uniform="day")
            key = key_offset(13 - i)
            count = len(self.state["records"].get(key, []))
            bg = "#d8f3e5" if count else "white"
            button = tk.Button(
                self.history_frame, text=f"{count}\n{key[5:]}", command=lambda k=key: self.set_record(k),
                bg=bg, fg=BLUE, relief="solid", bd=1, font=("Microsoft YaHei UI", 8, "bold"), pady=7
            )
            if i == 13:
                button.configure(highlightbackground="#ffbb55", highlightthickness=2)
            button.grid(row=0, column=i, sticky="ew", padx=3)

    def remind(self):
        if self.pet.winfo_exists():
            remaining = max(0, self.state["settings"]["daily_goal"] - self.today_count())
            if remaining:
                self.pet.show_bubble(f"该背单词啦！还差 {remaining} 个")
            else:
                self.pet.show_bubble("今天已达标，真棒！", "happy")
            if self.state["settings"]["sound"]:
                beep()

    def schedule_tick(self):
        if in_reminder_window(self.state["settings"]):
            now = datetime.now().timestamp()
            last = self.last_remind
            if now - last >= self.state["settings"]["interval_minutes"] * 60:
                self.remind()
                self.last_remind = now
        self.root.after(30000, self.schedule_tick)


def main():
    root = tk.Tk()
    root.withdraw()
    app = WordCatApp(root)
    app.last_remind = datetime.now().timestamp()
    root.protocol("WM_DELETE_WINDOW", app.quit_app)
    root.mainloop()


if __name__ == "__main__":
    main()


