const menuItems = [
  "\u6587\u4ef6",
  "\u7f16\u8f91",
  "\u8bbe\u7f6e",
  "\u5173\u4e8e"
];

export function TitleMenuBar() {
  return (
    <nav className="no-drag flex h-10 items-center gap-1" aria-label="Application menu">
      {menuItems.map((item) => (
        <button
          key={item}
          type="button"
          className="title-menu-button h-7 rounded-md px-3 text-[0.8125rem] leading-7 text-slate-600 transition hover:bg-slate-900/6 hover:text-slate-900"
        >
          {item}
        </button>
      ))}
    </nav>
  );
}
