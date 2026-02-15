import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api, AgentStats, AgentWallet, RoomInfo } from "@/lib/api";
import { useOperatorKey } from "@/hooks/useOperatorKey";

interface UserDashboardProps {
  onClose: () => void;
  onJoinGame: (roomId: string) => void;
  allRooms: RoomInfo[];
}

interface AgentExtended extends AgentWallet {
  stats?: AgentStats;
  balance?: {
    balance: string;
    balanceMON: number;
    totalDeposited: string;
    totalWon: string;
    totalLost: string;
    wagerAmount: string;
  };
}

interface WithdrawState {
  agentAddress: string;
  loading: boolean;
  error?: string;
  success?: string;
}

export function UserDashboard({ onClose, onJoinGame, allRooms }: UserDashboardProps) {
  const { operatorKey, loading: keyLoading, error: keyError } = useOperatorKey();
  const [agents, setAgents] = useState<AgentExtended[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [withdrawState, setWithdrawState] = useState<WithdrawState | null>(null);

  // Calculate total balance across all agents
  const totalBalance = agents.reduce((sum, agent) => {
    return sum + (agent.balance?.balanceMON || 0);
  }, 0);

  const totalProfit = agents.reduce((sum, agent) => {
    if (!agent.balance) return sum;
    return sum + Number(BigInt(agent.balance.totalWon) - BigInt(agent.balance.totalLost)) / 1e18;
  }, 0);

  const handleWithdraw = async (agentAddress: string, amount: string = "max") => {
    if (!operatorKey) return;

    setWithdrawState({ agentAddress, loading: true });
    try {
      const result = await api.withdrawFunds(operatorKey.operatorKey, agentAddress, amount);
      if (result.success) {
        setWithdrawState({
          agentAddress,
          loading: false,
          success: `Withdrawn! TX: ${result.txHash?.slice(0, 10)}...`
        });
        // Refresh data after successful withdrawal
        setTimeout(() => {
          loadData();
          setWithdrawState(null);
        }, 3000);
      } else {
        setWithdrawState({
          agentAddress,
          loading: false,
          error: result.error || "Withdrawal failed"
        });
      }
    } catch (e) {
      setWithdrawState({
        agentAddress,
        loading: false,
        error: "Network error"
      });
    }
  };

  useEffect(() => {
    if (operatorKey) {
        loadData();
    } else if (!keyLoading) {
        setDataLoading(false);
    }
  }, [operatorKey, keyLoading]);

  const loadData = async () => {
    if (!operatorKey) return;
    
    setDataLoading(true);
    try {
      // 1. Fetch agents list
      const { agents: agentList } = await api.listAgents(operatorKey.operatorKey);
      
      // 2. Fetch details for each agent
      const extendedAgents = await Promise.all(
        agentList.map(async (agent) => {
          try {
            const [stats, balance] = await Promise.all([
              api.getAgentStats(agent.address).catch(() => undefined),
              api.getWagerBalance(agent.address).catch(() => undefined),
            ]);
            return { ...agent, stats, balance };
          } catch (e) {
            return agent;
          }
        })
      );

      setAgents(extendedAgents);
    } catch (e) {
      setError("Failed to load dashboard data");
    } finally {
      setDataLoading(false);
    }
  };

  const findActiveRoom = (address: string) => {
    return allRooms.find(r => r.players.some(p => p.address.toLowerCase() === address.toLowerCase() && p.isAlive));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-5xl bg-slate-900/90 border border-emerald-500/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-6 border-b border-emerald-500/20 bg-black/20">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-2xl font-black text-white tracking-wider flex items-center gap-3">
                <span className="text-emerald-400">OPERATOR DASHBOARD</span>
              </h2>
              <div className="text-xs font-mono text-emerald-500/60 mt-1">
                KEY: {operatorKey?.operatorKey || "LOADING..."}
              </div>
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold text-white transition-colors"
            >
              CLOSE
            </button>
          </div>

          {/* Total Balance Summary */}
          {!dataLoading && agents.length > 0 && (
            <div className="grid grid-cols-3 gap-4 mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
              <div className="text-center">
                <div className="text-[10px] text-emerald-400/70 uppercase mb-1">Total Vault Balance</div>
                <div className="text-xl font-black text-white">
                  {totalBalance.toFixed(4)} <span className="text-sm text-emerald-400">MON</span>
                </div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-emerald-400/70 uppercase mb-1">Total Net Profit</div>
                <div className={`text-xl font-black ${totalProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {totalProfit >= 0 ? "+" : ""}{totalProfit.toFixed(4)} <span className="text-sm opacity-70">MON</span>
                </div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-emerald-400/70 uppercase mb-1">Active Agents</div>
                <div className="text-xl font-black text-white">
                  {agents.length}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {keyLoading || dataLoading ? (
            <div className="flex items-center justify-center h-64 text-emerald-500">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mr-3"></div>
              LOADING AGENT DATA...
            </div>
          ) : (error || keyError) ? (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-center">
              {error || keyError}
              <button onClick={loadData} className="ml-4 underline hover:text-red-300">Retry</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.map((agent) => {
                const activeRoom = findActiveRoom(agent.address);
                const balance = agent.balance;
                const stats = agent.stats;

                return (
                  <div key={agent.address} className="bg-black/40 border border-white/10 rounded-xl p-4 hover:border-emerald-500/30 transition-colors group relative overflow-hidden">
                    {/* Status Indicator */}
                    <div className={`absolute top-0 right-0 px-3 py-1 text-[10px] font-bold uppercase rounded-bl-lg ${
                      activeRoom ? "bg-emerald-500 text-black" : "bg-white/5 text-slate-500"
                    }`}>
                      {activeRoom ? "IN GAME" : "IDLE"}
                    </div>

                    <div className="mb-4">
                      <div className="text-[10px] text-slate-500 font-mono mb-1">AGENT ADDRESS</div>
                      <div className="font-mono text-xs text-emerald-400 truncate" title={agent.address}>
                        {agent.address}
                      </div>
                    </div>

                    {/* Financials */}
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      <div className="bg-white/5 p-2 rounded-lg">
                        <div className="text-[9px] text-slate-400 uppercase">Balance</div>
                        <div className="text-sm font-bold text-white">
                          {balance ? balance.balanceMON.toFixed(4) : "0.0000"} <span className="text-[10px] text-slate-500">MON</span>
                        </div>
                      </div>
                      <div className="bg-white/5 p-2 rounded-lg">
                        <div className="text-[9px] text-slate-400 uppercase">Net Profit</div>
                        <div className={`text-sm font-bold ${
                          balance && (BigInt(balance.totalWon) > BigInt(balance.totalLost)) 
                            ? "text-green-400" 
                            : balance && (BigInt(balance.totalLost) > 0) ? "text-red-400" : "text-white"
                        }`}>
                          {balance 
                            ? ((Number(BigInt(balance.totalWon) - BigInt(balance.totalLost)) / 1e18).toFixed(4))
                            : "0.0000"
                          } <span className="text-[10px] opacity-70">MON</span>
                        </div>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                      <div>
                        <div className="text-lg font-black text-white">{stats?.wins || 0}</div>
                        <div className="text-[8px] text-slate-500 uppercase">Wins</div>
                      </div>
                      <div>
                        <div className="text-lg font-black text-white">{stats?.kills || 0}</div>
                        <div className="text-[8px] text-slate-500 uppercase">Kills</div>
                      </div>
                      <div>
                        <div className="text-lg font-black text-white">{stats?.gamesPlayed || 0}</div>
                        <div className="text-[8px] text-slate-500 uppercase">Games</div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="space-y-2">
                      {activeRoom && (
                        <button
                          onClick={() => onJoinGame(activeRoom.roomId)}
                          className="w-full py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 rounded-lg text-emerald-300 text-xs font-bold transition-colors flex items-center justify-center gap-2"
                        >
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"/>
                          WATCH GAME {activeRoom.roomId.slice(0, 6)}...
                        </button>
                      )}

                      {/* Withdraw Button */}
                      {balance && balance.balanceMON > 0 && !activeRoom && (
                        <button
                          onClick={() => handleWithdraw(agent.address)}
                          disabled={withdrawState?.agentAddress === agent.address && withdrawState.loading}
                          className="w-full py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 rounded-lg text-amber-300 text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {withdrawState?.agentAddress === agent.address ? (
                            withdrawState.loading ? (
                              <span className="flex items-center justify-center gap-2">
                                <span className="animate-spin">⏳</span> WITHDRAWING...
                              </span>
                            ) : withdrawState.success ? (
                              <span className="text-green-400">{withdrawState.success}</span>
                            ) : withdrawState.error ? (
                              <span className="text-red-400">{withdrawState.error}</span>
                            ) : null
                          ) : (
                            <>WITHDRAW {balance.balanceMON.toFixed(4)} MON</>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              
              {agents.length === 0 && (
                <div className="col-span-full p-12 text-center border-2 border-dashed border-white/10 rounded-xl text-slate-500">
                  <div className="mb-2 text-4xl">🤖</div>
                  <div className="text-lg font-bold text-white mb-1">No Agents Found</div>
                  <div className="text-sm">Create an agent using the "Create Agent" button in the menu or CLI.</div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
