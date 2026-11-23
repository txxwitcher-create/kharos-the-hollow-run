import React, { useState } from 'react';
import { Check, Gift, Palette, ShoppingBag, Sparkles, Trophy, X } from 'lucide-react';
import {
  ACHIEVEMENTS,
  DAILY_MISSIONS,
  OPTIONAL_COIN_PACKS,
  PREMIUM_THEMES,
  getThemeById,
} from '../data/catalog';
import { getAchievementProgress } from '../game/rules';
import { SaveData } from '../types/game';
import { CoinSvg } from './Icons';

interface ThemesShopModalProps {
  save: SaveData;
  onSelectOrBuyTheme: (themeId: string) => void;
  onGrantCoinPack: (packId: string, coins: number) => void;
  onClose: () => void;
}

export const ThemesShopModal: React.FC<ThemesShopModalProps> = ({
  save,
  onSelectOrBuyTheme,
  onGrantCoinPack,
  onClose,
}) => {
  const [tab, setTab] = useState<'themes' | 'packs'>('themes');
  const activeTheme = getThemeById(save.selectedTheme);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#0b0e14]/96 p-4">
      <div className="flex items-center justify-between pb-3 border-b border-stone-800">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400">
            Cosmetic Art Direction & Coin Treasury
          </p>
          <h2 className="font-display font-extrabold text-xl text-stone-100">THEMES & SHOP</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-900 border border-stone-700 text-xs font-bold tabular-nums text-amber-200">
            <CoinSvg color={activeTheme.coinColor} className="w-4 h-4" />
            {save.coins.toLocaleString()}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 flex items-center justify-center"
            aria-label="Close Themes and Shop"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 mt-3 bg-stone-950/80 p-1 rounded-xl border border-stone-800">
        <button
          type="button"
          onClick={() => setTab('themes')}
          className={`py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 ${
            tab === 'themes' ? 'text-stone-950' : 'text-stone-300'
          }`}
          style={tab === 'themes' ? { backgroundColor: activeTheme.uiAccent } : undefined}
        >
          <Palette className="w-3.5 h-3.5" />
          Premium Themes
        </button>
        <button
          type="button"
          onClick={() => setTab('packs')}
          className={`py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 ${
            tab === 'packs' ? 'text-stone-950' : 'text-stone-300'
          }`}
          style={tab === 'packs' ? { backgroundColor: activeTheme.uiAccent } : undefined}
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          Optional Packs
        </button>
      </div>

      <div className="flex-1 overflow-y-auto kharos-scroll mt-3 space-y-2.5 pr-1">
        {tab === 'themes' ? (
          <>
            <p className="text-[11px] text-stone-400">
              Themes refine UI, coin finishes, rim lighting, and particles while keeping each of the 20 realms unmistakably authentic.
            </p>
            {PREMIUM_THEMES.map((t) => {
              const owned = save.unlockedThemes.includes(t.id);
              const equipped = save.selectedTheme === t.id;
              return (
                <div
                  key={t.id}
                  className="rounded-xl bg-stone-900/85 border p-3.5 space-y-2"
                  style={{ borderColor: equipped ? t.uiAccent : '#27272a' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-7 h-7 rounded-lg border border-white/30 shrink-0"
                        style={{ backgroundColor: t.uiAccent }}
                      />
                      <div>
                        <div className="text-sm font-bold text-stone-100">{t.name}</div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                          {t.rarity}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={equipped || (!owned && save.coins < t.price)}
                      onClick={() => onSelectOrBuyTheme(t.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 disabled:opacity-45 cursor-pointer"
                      style={
                        equipped
                          ? { backgroundColor: '#1f2937', color: '#a8a29e' }
                          : { backgroundColor: t.uiAccent, color: '#0c0a09' }
                      }
                    >
                      {equipped ? 'Active' : owned ? 'Apply' : `${t.price.toLocaleString()}`}
                    </button>
                  </div>
                  <p className="text-[11px] text-stone-400 leading-snug">{t.description}</p>
                </div>
              );
            })}
          </>
        ) : (
          <>
            <p className="text-[11px] text-stone-400">
              100% optional coin bundles — zero pay-to-win, zero loot boxes. Every item can be earned purely through runs.
            </p>
            {OPTIONAL_COIN_PACKS.map((pack) => (
              <div
                key={pack.id}
                className="rounded-xl bg-stone-900/85 border border-stone-800 p-3.5 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-sm font-bold text-stone-100">{pack.name}</div>
                  <div className="flex items-center gap-1.5 text-amber-300 font-extrabold text-sm tabular-nums mt-0.5">
                    <CoinSvg color={activeTheme.coinColor} className="w-4 h-4" />
                    +{pack.coins.toLocaleString()} Coins
                  </div>
                  {pack.valueBadge && (
                    <div className="text-[10px] font-semibold text-emerald-400 mt-0.5">
                      {pack.valueBadge}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => onGrantCoinPack(pack.id, pack.coins)}
                  className="px-3 py-2 rounded-lg text-xs font-bold text-stone-950 shrink-0 cursor-pointer flex items-center gap-1"
                  style={{ backgroundColor: activeTheme.uiAccent }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {pack.priceLabel}
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

interface MissionsModalProps {
  save: SaveData;
  onClaimMission: (id: string) => void;
  onClaimAchievement: (id: string) => void;
  onClose: () => void;
}

export const MissionsModal: React.FC<MissionsModalProps> = ({
  save,
  onClaimMission,
  onClaimAchievement,
  onClose,
}) => {
  const [tab, setTab] = useState<'daily' | 'achievements'>('daily');
  const theme = getThemeById(save.selectedTheme);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#0b0e14]/96 p-4">
      <div className="flex items-center justify-between pb-3 border-b border-stone-800">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400">
            Daily Quests & Lifetime Honors
          </p>
          <h2 className="font-display font-extrabold text-xl text-stone-100">MISSIONS & ACHIEVEMENTS</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 flex items-center justify-center"
          aria-label="Close Missions"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1.5 mt-3 bg-stone-950/80 p-1 rounded-xl border border-stone-800">
        <button
          type="button"
          onClick={() => setTab('daily')}
          className={`py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 ${
            tab === 'daily' ? 'text-stone-950' : 'text-stone-300'
          }`}
          style={tab === 'daily' ? { backgroundColor: theme.uiAccent } : undefined}
        >
          <Gift className="w-3.5 h-3.5" />
          Daily Missions
        </button>
        <button
          type="button"
          onClick={() => setTab('achievements')}
          className={`py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 ${
            tab === 'achievements' ? 'text-stone-950' : 'text-stone-300'
          }`}
          style={tab === 'achievements' ? { backgroundColor: theme.uiAccent } : undefined}
        >
          <Trophy className="w-3.5 h-3.5" />
          Achievements
        </button>
      </div>

      <div className="flex-1 overflow-y-auto kharos-scroll mt-3 space-y-2 pr-1">
        {tab === 'daily'
          ? DAILY_MISSIONS.map((m) => {
              const prog = Math.min(m.target, save.missionProgress[m.id] ?? 0);
              const claimed = save.claimedMissions.includes(m.id);
              const ready = prog >= m.target && !claimed;
              const pct = Math.round((prog / m.target) * 100);
              return (
                <div
                  key={m.id}
                  className="rounded-xl bg-stone-900/85 border border-stone-800 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-stone-100">{m.title}</div>
                      <div className="text-[11px] text-stone-400 tabular-nums mt-0.5">
                        {prog.toLocaleString()} / {m.target.toLocaleString()}
                      </div>
                    </div>

                    {claimed ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                        <Check className="w-3.5 h-3.5" />
                        Claimed
                      </span>
                    ) : ready ? (
                      <button
                        type="button"
                        onClick={() => onClaimMission(m.id)}
                        className="px-3 py-1 rounded-lg text-xs font-bold text-stone-950 cursor-pointer"
                        style={{ backgroundColor: theme.uiAccent }}
                      >
                        Claim +{m.reward}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-bold text-amber-300 tabular-nums">
                        <CoinSvg color={theme.coinColor} className="w-3.5 h-3.5" />
                        +{m.reward}
                      </span>
                    )}
                  </div>
                  <div className="h-1.5 rounded-full bg-stone-800 overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: theme.uiAccent }}
                    />
                  </div>
                </div>
              );
            })
          : ACHIEVEMENTS.map((a) => {
              const prog = Math.min(a.target, getAchievementProgress(save, a.metric));
              const claimed = save.claimedAchievements.includes(a.id);
              const ready = prog >= a.target && !claimed;
              const pct = Math.round((prog / a.target) * 100);
              return (
                <div
                  key={a.id}
                  className="rounded-xl bg-stone-900/85 border border-stone-800 p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-stone-100">{a.title}</div>
                      <p className="text-[11px] text-stone-400 mt-0.5">{a.description}</p>
                      <div className="text-[10px] text-stone-400 tabular-nums mt-0.5">
                        {prog.toLocaleString()} / {a.target.toLocaleString()}
                      </div>
                    </div>

                    {claimed ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 shrink-0">
                        <Check className="w-3.5 h-3.5" />
                        Done
                      </span>
                    ) : ready ? (
                      <button
                        type="button"
                        onClick={() => onClaimAchievement(a.id)}
                        className="px-3 py-1 rounded-lg text-xs font-bold text-stone-950 shrink-0 cursor-pointer"
                        style={{ backgroundColor: theme.uiAccent }}
                      >
                        Claim +{a.reward}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-bold text-amber-300 tabular-nums shrink-0">
                        <CoinSvg color={theme.coinColor} className="w-3.5 h-3.5" />
                        +{a.reward.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="h-1.5 rounded-full bg-stone-800 overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: theme.uiAccent }}
                    />
                  </div>
                </div>
              );
            })}
      </div>
    </div>
  );
};
