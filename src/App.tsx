import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CampaignModal } from './components/CampaignModal';
import { CharactersModal } from './components/CharactersModal';
import { GameHud } from './components/GameHud';
import { MissionsModal, ThemesShopModal } from './components/ProgressionModals';
import { SettingsModal } from './components/SettingsModal';
import { GameOverModal, LoadingOverlay, PauseModal, VictoryModal } from './components/StatusModals';
import { ActiveDrawer, TitleOverlay } from './components/TitleOverlay';
import { ACHIEVEMENTS, DAILY_MISSIONS, getThemeById } from './data/catalog';
import { KharosAudioEngine } from './game/audio';
import { KharosRunnerEngine } from './game/engine';
import {
  claimAchievementReward,
  claimMissionReward,
  createInitialSaveData,
  getAchievementProgress,
  grantCoins,
  loadSaveFromStorage,
  persistSaveToStorage,
  purchaseOutfit,
  purchaseTheme,
  recordRunResult,
  unlockCharacter,
  upgradeAbility,
} from './game/rules';
import {
  AllSettings,
  CharacterId,
  GameState,
  LevelRewardBreakdown,
  LiveHudSnapshot,
  PlayMode,
  RunStats,
  SaveData,
} from './types/game';

const INITIAL_HUD: LiveHudSnapshot = {
  distance: 0,
  targetDistance: 650,
  coins: 0,
  speedKmh: 28,
  abilityCharge: 100,
  abilityActiveRatio: 0,
  abilityReady: true,
  shieldActive: false,
  hollowThreat: 0,
  turnPrompt: null,
  activeRouteLabel: null,
  tutorialHint: null,
  tutorialStep: 1,
  tutorialTotal: 9,
  nearMissBanner: null,
  fps: 60,
};

export function App() {
  const [save, setSave] = useState<SaveData>(() => loadSaveFromStorage());
  const [gameState, setGameState] = useState<GameState>('title');
  const [selectedMode, setSelectedMode] = useState<PlayMode>('campaign');
  const [selectedLevelId, setSelectedLevelId] = useState<number>(() =>
    Math.min(20, loadSaveFromStorage().highestUnlockedLevel),
  );
  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawer>(null);
  const [pauseSettingsOpen, setPauseSettingsOpen] = useState(false);
  const [hud, setHud] = useState<LiveHudSnapshot>(INITIAL_HUD);
  const [lastRunStats, setLastRunStats] = useState<RunStats | null>(null);
  const [lastRewards, setLastRewards] = useState<LevelRewardBreakdown | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<KharosRunnerEngine | null>(null);
  const audioRef = useRef<KharosAudioEngine | null>(null);
  const saveRef = useRef<SaveData>(save);
  const stateRef = useRef<GameState>(gameState);
  const drawerRef = useRef<ActiveDrawer>(activeDrawer);

  saveRef.current = save;
  stateRef.current = gameState;
  drawerRef.current = activeDrawer;

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 2200);
  }, []);

  const commitSave = useCallback((next: SaveData) => {
    const persisted = persistSaveToStorage(next);
    setSave(persisted);
    audioRef.current?.applySettings(persisted.settings.audio);
    engineRef.current?.updateSaveState(persisted);
  }, []);

  // Mirror game state to document.body.dataset.state ('title' | 'playing' | 'paused' | 'gameover')
  useEffect(() => {
    const bodyState =
      gameState === 'victory'
        ? 'gameover'
        : gameState === 'loading'
          ? 'playing'
          : gameState;
    document.body.dataset.state = bodyState;
  }, [gameState]);

  const launchExpedition = useCallback(
    (mode: PlayMode, levelId: number, instant = false) => {
      audioRef.current?.unlock();
      audioRef.current?.playUiClick();
      setActiveDrawer(null);
      setPauseSettingsOpen(false);
      setSelectedMode(mode);
      setSelectedLevelId(levelId);
      setLastRunStats(null);
      setLastRewards(null);

      // Immediately enter playing state (and blur focused buttons so Space doesn't re-click UI)
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      document.body.dataset.state = 'playing';

      if (instant) {
        setGameState('playing');
        engineRef.current?.startRun(mode, levelId);
        return;
      }

      setGameState('loading');
      window.setTimeout(() => {
        setGameState('playing');
        engineRef.current?.startRun(mode, levelId);
      }, 260);
    },
    [],
  );

  // Mount Three.js WebGLRenderer & Audio Engine ONCE
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const audio = new KharosAudioEngine(saveRef.current.settings.audio);
    audioRef.current = audio;

    const engine = new KharosRunnerEngine(container, saveRef.current, audio, {
      onHudUpdate: (snapshot) => {
        setHud(snapshot);
      },
      onGameOver: (stats) => {
        const { nextSave } = recordRunResult(saveRef.current, stats, false);
        const persisted = persistSaveToStorage(nextSave);
        setSave(persisted);
        engine.updateSaveState(persisted);
        setLastRunStats(stats);
        setLastRewards(null);
        setGameState('gameover');
      },
      onVictory: (stats) => {
        const { nextSave, rewardBreakdown } = recordRunResult(saveRef.current, stats, true);
        const persisted = persistSaveToStorage(nextSave);
        setSave(persisted);
        engine.updateSaveState(persisted);
        setLastRunStats(stats);
        setLastRewards(rewardBreakdown);
        setGameState('victory');
      },
      onPauseRequested: () => {
        if (stateRef.current === 'playing') {
          engine.setGameState('paused');
          setGameState('paused');
        }
      },
    });
    engineRef.current = engine;

    // Support ?autostart=1 to skip directly into active gameplay for instant testing
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      document.body.dataset.state = 'playing';
      setGameState('playing');
      engine.startRun('campaign', Math.min(20, saveRef.current.highestUnlockedLevel));
    }

    return () => {
      engine.dispose();
      audio.dispose();
      engineRef.current = null;
      audioRef.current = null;
    };
  }, []);

  // Title Screen Enter / Space start handshake & Pause Escape/P toggle
  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      const isPauseKey = e.code === 'Escape' || e.key === 'Escape' || e.code === 'KeyP' || e.key === 'p' || e.key === 'P';
      if (stateRef.current === 'title' && !drawerRef.current) {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          launchExpedition(selectedMode, selectedLevelId, true);
        }
      } else if (stateRef.current === 'playing' && isPauseKey) {
        e.preventDefault();
        stateRef.current = 'paused';
        engineRef.current?.setGameState('paused');
        setGameState('paused');
      } else if (stateRef.current === 'paused' && !pauseSettingsOpen && isPauseKey) {
        e.preventDefault();
        stateRef.current = 'playing';
        engineRef.current?.setGameState('playing');
        setGameState('playing');
      }
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, [launchExpedition, selectedLevelId, selectedMode, pauseSettingsOpen]);

  // Count unclaimed missions & achievements for title badge
  const unclaimedRewardsCount = useMemo(() => {
    let count = 0;
    for (const m of DAILY_MISSIONS) {
      if (!save.claimedMissions.includes(m.id) && (save.missionProgress[m.id] ?? 0) >= m.target) {
        count++;
      }
    }
    for (const a of ACHIEVEMENTS) {
      if (!save.claimedAchievements.includes(a.id) && getAchievementProgress(save, a.metric) >= a.target) {
        count++;
      }
    }
    return count;
  }, [save]);

  const handleToggleMute = useCallback(() => {
    const nextSettings: AllSettings = {
      ...saveRef.current.settings,
      audio: { ...saveRef.current.settings.audio, muted: !saveRef.current.settings.audio.muted },
    };
    commitSave({ ...saveRef.current, settings: nextSettings });
  }, [commitSave]);

  const handleReturnToTitle = useCallback(() => {
    audioRef.current?.playUiClick();
    setPauseSettingsOpen(false);
    setActiveDrawer(null);
    engineRef.current?.setGameState('title');
    setGameState('title');
  }, []);

  const theme = getThemeById(save.selectedTheme);

  // Accessibility filter classes
  const accessClasses = [
    save.settings.accessibility.highContrast ? 'high-contrast-mode' : '',
    save.settings.accessibility.colorblindMode !== 'none'
      ? `cb-${save.settings.accessibility.colorblindMode}`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <main className="fixed inset-0 flex items-center justify-center bg-[#06080c] overflow-hidden">
      {/* Subtle ambient background framing for landscape desktop viewports enforcing 9:16 portrait mobile lock */}
      <div
        className={`relative h-full w-full max-w-[min(100vw,calc(100dvh*9/16))] max-h-[100dvh] overflow-hidden bg-[#0c1018] shadow-[0_0_80px_rgba(0,0,0,0.95)] sm:border-x ${accessClasses}`}
        style={{
          borderColor: theme.uiBorder,
          fontSize: `${Math.round(save.settings.accessibility.uiScale * 100)}%`,
        }}
        data-testid="portrait-game-shell"
      >
        {/* Dedicated Isolated WebGL Canvas Container — NEVER re-rendered by React HUD updates */}
        <div
          ref={canvasMountRef}
          data-testid="game-canvas-container"
          className="absolute inset-0 z-0"
        />

        {/* Title Screen */}
        {gameState === 'title' && (
          <TitleOverlay
            save={save}
            selectedLevelId={selectedLevelId}
            selectedMode={selectedMode}
            unclaimedRewardsCount={unclaimedRewardsCount}
            onModeChange={(mode) => {
              audioRef.current?.playUiClick();
              setSelectedMode(mode);
            }}
            onStartPlay={() => launchExpedition(selectedMode, selectedLevelId, true)}
            onOpenDrawer={(drawer) => {
              audioRef.current?.playUiClick();
              setActiveDrawer(drawer);
            }}
            onToggleMute={handleToggleMute}
          />
        )}

        {/* Active Gameplay HUD */}
        {gameState === 'playing' && (
          <GameHud
            hud={hud}
            save={save}
            mode={selectedMode}
            levelId={selectedLevelId}
            onPause={() => {
              audioRef.current?.playUiClick();
              engineRef.current?.setGameState('paused');
              setGameState('paused');
            }}
            onToggleMute={handleToggleMute}
            onActivateAbility={() => engineRef.current?.triggerAbilityFromUi()}
          />
        )}

        {/* Loading Transition Overlay */}
        {gameState === 'loading' && (
          <LoadingOverlay levelId={selectedLevelId} themeId={save.selectedTheme} />
        )}

        {/* Pause Modal */}
        {gameState === 'paused' && !pauseSettingsOpen && (
          <PauseModal
            save={save}
            levelId={selectedLevelId}
            onResume={() => {
              audioRef.current?.playUiClick();
              engineRef.current?.setGameState('playing');
              setGameState('playing');
            }}
            onRestart={() => launchExpedition(selectedMode, selectedLevelId, true)}
            onOpenSettings={() => {
              audioRef.current?.playUiClick();
              setPauseSettingsOpen(true);
            }}
            onMainMenu={handleReturnToTitle}
          />
        )}

        {/* Settings opened from Pause */}
        {gameState === 'paused' && pauseSettingsOpen && (
          <SettingsModal
            save={save}
            isSoftwareGl={Boolean(engineRef.current?.isSoftwareGl)}
            onUpdateSettings={(nextSettings) => commitSave({ ...save, settings: nextSettings })}
            onReplayTutorial={() => {
              setPauseSettingsOpen(false);
              launchExpedition('tutorial', 1, false);
            }}
            onDeleteSaveData={() => {
              const fresh = createInitialSaveData();
              commitSave(fresh);
              setSelectedLevelId(1);
              handleReturnToTitle();
              showToast('All game data reset.');
            }}
            onClose={() => {
              audioRef.current?.playUiClick();
              setPauseSettingsOpen(false);
            }}
          />
        )}

        {/* Game Over Modal */}
        {gameState === 'gameover' && lastRunStats && (
          <GameOverModal
            save={save}
            stats={lastRunStats}
            onRetry={() => launchExpedition(lastRunStats.mode, lastRunStats.levelId, true)}
            onMainMenu={handleReturnToTitle}
          />
        )}

        {/* Level Completed Victory Modal */}
        {gameState === 'victory' && lastRunStats && (
          <VictoryModal
            save={save}
            stats={lastRunStats}
            rewards={lastRewards}
            onNextLevel={() => {
              const nextId = Math.min(20, lastRunStats.levelId + 1);
              launchExpedition('campaign', nextId, false);
            }}
            onReplay={() => launchExpedition(lastRunStats.mode, lastRunStats.levelId, true)}
            onMainMenu={handleReturnToTitle}
          />
        )}

        {/* Title Screen Drawers / Full Sub-Screens */}
        {gameState === 'title' && activeDrawer === 'campaign' && (
          <CampaignModal
            save={save}
            selectedLevelId={selectedLevelId}
            onSelectLevel={(lvlId) => {
              audioRef.current?.playUiClick();
              setSelectedLevelId(lvlId);
              setSelectedMode('campaign');
              engineRef.current?.previewLevel(lvlId);
            }}
            onLaunchLevel={(lvlId) => launchExpedition('campaign', lvlId, false)}
            onClose={() => {
              audioRef.current?.playUiClick();
              setActiveDrawer(null);
            }}
          />
        )}

        {gameState === 'title' && activeDrawer === 'characters' && (
          <CharactersModal
            save={save}
            onSelectCharacter={(id: CharacterId) => {
              audioRef.current?.playUiClick();
              commitSave({ ...save, selectedCharacter: id });
            }}
            onUnlockCharacter={(id: CharacterId) => {
              const next = unlockCharacter(save, id);
              if (next) {
                audioRef.current?.playUiPurchase();
                commitSave(next);
                showToast('Explorer unlocked!');
              }
            }}
            onEquipOrBuyOutfit={(outfitId: string) => {
              const next = purchaseOutfit(save, outfitId);
              if (next) {
                audioRef.current?.playUiPurchase();
                commitSave(next);
                showToast('Outfit equipped!');
              }
            }}
            onUpgradeAbility={(abilityId) => {
              const next = upgradeAbility(save, abilityId);
              if (next) {
                audioRef.current?.playUiPurchase();
                commitSave(next);
                showToast('Ability upgraded!');
              }
            }}
            onClose={() => {
              audioRef.current?.playUiClick();
              setActiveDrawer(null);
            }}
          />
        )}

        {gameState === 'title' && activeDrawer === 'themes' && (
          <ThemesShopModal
            save={save}
            onSelectOrBuyTheme={(themeId) => {
              const next = purchaseTheme(save, themeId);
              if (next) {
                audioRef.current?.playUiPurchase();
                commitSave(next);
                showToast('Theme applied!');
              }
            }}
            onGrantCoinPack={(packId, coins) => {
              const next = grantCoins(save, coins, `demo_pack_${packId}`);
              audioRef.current?.playUiPurchase();
              commitSave(next);
              showToast(`+${coins.toLocaleString()} coins added!`);
            }}
            onClose={() => {
              audioRef.current?.playUiClick();
              setActiveDrawer(null);
            }}
          />
        )}

        {gameState === 'title' && activeDrawer === 'missions' && (
          <MissionsModal
            save={save}
            onClaimMission={(id) => {
              const next = claimMissionReward(save, id);
              if (next) {
                audioRef.current?.playUiPurchase();
                commitSave(next);
                showToast('Mission reward claimed!');
              }
            }}
            onClaimAchievement={(id) => {
              const next = claimAchievementReward(save, id);
              if (next) {
                audioRef.current?.playUiPurchase();
                commitSave(next);
                showToast('Achievement reward claimed!');
              }
            }}
            onClose={() => {
              audioRef.current?.playUiClick();
              setActiveDrawer(null);
            }}
          />
        )}

        {gameState === 'title' && activeDrawer === 'settings' && (
          <SettingsModal
            save={save}
            isSoftwareGl={Boolean(engineRef.current?.isSoftwareGl)}
            onUpdateSettings={(nextSettings) => commitSave({ ...save, settings: nextSettings })}
            onReplayTutorial={() => launchExpedition('tutorial', 1, false)}
            onDeleteSaveData={() => {
              const fresh = createInitialSaveData();
              commitSave(fresh);
              setSelectedLevelId(1);
              engineRef.current?.previewLevel(1);
              setActiveDrawer(null);
              showToast('All game data reset.');
            }}
            onClose={() => {
              audioRef.current?.playUiClick();
              setActiveDrawer(null);
            }}
          />
        )}

        {/* Lightweight feedback toast */}
        {toastMessage && (
          <div
            role="status"
            className="absolute top-14 left-1/2 -translate-x-1/2 z-50 px-3.5 py-1.5 rounded-lg bg-stone-950/95 border text-xs font-bold text-amber-200 shadow-xl pointer-events-none whitespace-nowrap"
            style={{ borderColor: theme.uiAccent }}
          >
            {toastMessage}
          </div>
        )}
      </div>
    </main>
  );
}

export default App;
