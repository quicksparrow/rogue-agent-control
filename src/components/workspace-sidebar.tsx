"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity, BookOpen, CreditCard, Layers3,
  Menu, Search, ShieldCheck, ShoppingBag, SquareActivity, X,
} from "lucide-react";

const destinations = [
  { id: "black-box", label: "Black Box", href: "/", icon: Layers3, group: "Workspace" },
  { id: "investigate", label: "Investigation & replay", href: "/investigate", icon: Search, group: "Workspace" },
  { id: "shopping", label: "Shopping agent", href: "/shopping", icon: ShoppingBag, group: "Purchasing" },
  { id: "firewall", label: "Policy Firewall", href: "/firewall", icon: ShieldCheck, group: "Purchasing" },
  { id: "checkout", label: "Sandbox checkout", href: "/checkout", icon: CreditCard, group: "Purchasing" },
  { id: "demo", label: "Explore demo", href: "/demo", icon: BookOpen, group: "Resources" },
] as const;

export default function WorkspaceSidebar({ active }: { active: typeof destinations[number]["id"] }) {
  const [open, setOpen] = useState(false);
  const rail = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    function dismiss(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); }
    }
    function outside(event: PointerEvent) {
      if (!rail.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  return (
    <aside className="workspace-rail" ref={rail} onBlur={(e) => {
      if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
    }}>
      <div className="rail-mast">
        <a className="product-mark" href="/" aria-label="Rogue Agent Control home">
          <span className="product-symbol"><SquareActivity size={24} strokeWidth={1.65} /></span>
          <span>Rogue<span className="product-subtitle">Agent Control</span></span>
        </a>
        <button className="mobile-menu" type="button" ref={toggle}
          aria-controls="workspace-navigation" aria-expanded={open}
          aria-label={open ? "Close navigation" : "Open navigation"} onClick={() => setOpen(!open)}>
          {open ? <X size={20} /> : <Menu size={20} />} Menu
        </button>
      </div>
      <nav id="workspace-navigation" className={open ? "rail-nav is-open" : "rail-nav"} aria-label="Product navigation">
        {["Workspace", "Purchasing", "Resources"].map(group => (
          <div className="rail-group" key={group}>
            <p>{group}</p>
            {destinations.filter(item => item.group === group).map(({ id, href, label, icon: Icon }) => (
              <a href={href} key={id} aria-current={active === id ? "page" : undefined} onClick={() => setOpen(false)}>
                <Icon size={17} strokeWidth={1.7} aria-hidden="true" />{label}
              </a>
            ))}
          </div>
        ))}
      </nav>
      <div className="rail-environment"><Activity size={17} aria-hidden="true" /><span>Local workspace<small>Sandbox environment</small></span></div>
    </aside>
  );
}
