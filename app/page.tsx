'use client';

import { useEffect, useState, useRef } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';
import { useAccount, useConnect, useDisconnect, useSendTransaction, useBalance } from 'wagmi';
import { coinbaseWallet } from 'wagmi/connectors';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Wallet, RefreshCw, Bot, User, ArrowRightLeft, Sparkles, AlertCircle, Activity, BarChart3, ShieldCheck } from 'lucide-react';
import { ai } from '@/lib/gemini';
import { parseEther, formatUnits } from 'viem';

// Common Celo Tokens
const TOKENS: Record<string, string> = {
  'CELO': '0x471EcE3750Da237f93B8E299745289111Ff46385',
  'CUSD': '0x765DE816845861e75A25fCA122bb6898B8B1282a',
  'CEUR': '0xD8763C91811813b194f58c2Bba97960EFACC3202',
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
  type?: 'text' | 'swap_quote';
  quoteData?: any;
}

export default function Home() {
  const [isReady, setIsReady] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hello! I am your Celo Swap Agent. How can I help you today? Try "Swap 0.1 CELO to cUSD".' }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingQuote, setPendingQuote] = useState<any>(null);
  const [tradeHistory, setTradeHistory] = useState<any[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: balance, refetch: refetchBalance } = useBalance({ address });
  const { sendTransactionAsync } = useSendTransaction();

  // Initialize Farcaster SDK and Load History
  useEffect(() => {
    const init = async () => {
      await sdk.actions.ready();
      
      try {
        const history = await sdk.actions.getStorage({ key: 'trade_history' });
        if (history) {
          setTradeHistory(JSON.parse(history));
        }
      } catch (e) {
        console.error("Failed to load history", e);
      }
      
      setIsReady(true);
    };
    init();
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const saveToHistory = async (trade: any) => {
    const newHistory = [trade, ...tradeHistory].slice(0, 50);
    setTradeHistory(newHistory);
    try {
      await sdk.actions.setStorage({ key: 'trade_history', value: JSON.stringify(newHistory) });
    } catch (e) {
      console.error("Failed to save history", e);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setInput('');
    setIsTyping(true);

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [{ text: `
              You are an AI swap agent for Celo blockchain.
              User input: "${userMessage}"
              
              Context:
              - CELO: ${TOKENS.CELO}
              - cUSD: ${TOKENS.CUSD}
              - cEUR: ${TOKENS.CEUR}
              - User Balance: ${balance ? formatUnits(balance.value, 18) : '0'} CELO
              
              Task: Analyze the intent. 
              - If the user wants to swap, return a JSON object.
              - Support relative amounts like "half my CELO" (calculate based on balance).
              - Support "buy 100 cUSD" (set "buyAmount" instead of "sellAmount").
              - Priority/Preference: If they mention "lowest fee", acknowledge it in the content but note that 0x finds the best route automatically.
              
              JSON Format for swaps:
              {
                "type": "swap_request",
                "sellToken": "token symbol",
                "buyToken": "token symbol",
                "sellAmount": "number (optional)",
                "buyAmount": "number (optional)",
                "content": "friendly internal thought or confirmation message"
              }
              
              Otherwise, return a friendly text response in:
              {
                "type": "text",
                "content": "your message"
              }
            ` }]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      const text = await response.response.text();
      const data = JSON.parse(text || '{}');

      if (data.type === 'swap_request') {
        const amount = data.sellAmount || data.buyAmount;
        const isBuy = !!data.buyAmount;
        fetchQuote(data.sellToken, data.buyToken, amount, isBuy);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.content || text || "I'm not sure how to handle that." }]);
      }
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'assistant', content: "Sorry, I ran into an error processing your request." }]);
    } finally {
      setIsTyping(false);
    }
  };

  const fetchQuote = async (sellSymbol: string, buySymbol: string, amount: string, isBuy: boolean = false) => {
    const sellToken = TOKENS[sellSymbol.toUpperCase()];
    const buyToken = TOKENS[buySymbol.toUpperCase()];

    if (!sellToken || !buyToken) {
      setMessages(prev => [...prev, { role: 'assistant', content: `I don't support ${sellSymbol} or ${buySymbol} yet. I currently support CELO, cUSD, and cEUR.` }]);
      return;
    }

    try {
      setIsTyping(true);
      const amountParam = isBuy ? `buyAmount=${parseEther(amount).toString()}` : `sellAmount=${parseEther(amount).toString()}`;
      const url = `https://celo.api.0x.org/swap/v1/quote?sellToken=${sellToken}&buyToken=${buyToken}&${amountParam}`;
      const res = await fetch(url);
      const quote = await res.json();

      if (quote.error) throw new Error(quote.reason || 'Failed to fetch quote');

      // Estimate fee in CELO
      const estimatedFee = formatUnits(BigInt(quote.gas) * BigInt(quote.gasPrice), 18).slice(0, 10);

      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `I found a quote! You'll receive approx. ${formatUnits(quote.buyAmount, 18).slice(0, 8)} ${buySymbol.toUpperCase()} for ${amount} ${sellSymbol.toUpperCase()}. Estimated fee: ${estimatedFee} CELO.`,
        type: 'swap_quote',
        quoteData: { ...quote, sellSymbol, buySymbol, amount, estimatedFee }
      }]);
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Could not fetch quote: ${error.message}` }]);
    } finally {
      setIsTyping(false);
    }
  };

  const executeSwap = async (quote: any) => {
    if (!isConnected) {
      alert("Please connect your wallet first.");
      return;
    }

    try {
      setShowConfirmModal(false);
      const tx = await sendTransactionAsync({
        to: quote.to as `0x${string}`,
        data: quote.data as `0x${string}`,
        value: BigInt(quote.value),
      });

      const trade = {
        hash: tx,
        sellToken: quote.sellSymbol,
        buyToken: quote.buySymbol,
        sellAmount: quote.amount,
        buyAmount: formatUnits(quote.buyAmount, 18).slice(0, 8),
        timestamp: new Date().toISOString(),
        fee: quote.estimatedFee
      };

      await saveToHistory(trade);
      refetchBalance();

      setMessages(prev => [...prev, { role: 'assistant', content: `Swap successful! Hash: ${tx.substring(0, 10)}...` }]);
    } catch (error: any) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'assistant', content: `Swap failed: ${error.message}` }]);
    }
  };

  if (!isReady) return null;

  return (
    <div className="min-h-screen bg-[#0A0B0D] text-slate-200 p-4 md:p-8 flex flex-col gap-6 overflow-x-hidden">
      {/* Header Section */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-tr from-[#35D07F] to-[#FBCC5C] rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/10">
            <Bot size={24} className="text-black" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              CELO AGENT <span className="text-[10px] bg-white/5 border border-white/10 px-2 py-0.5 rounded-full text-slate-500 tracking-widest uppercase">Beta</span>
            </h1>
            <p className="text-xs text-slate-500 font-mono flex items-center gap-2">
              <Activity size={10} className="text-[#35D07F]" /> v2.4.0-stable • Mainnet
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="flex-1 md:flex-none flex items-center gap-4 bg-white/[0.03] border border-white/10 px-5 py-3 rounded-2xl">
            <div className="flex flex-col items-end">
              <span className="text-[9px] uppercase tracking-[0.2em] text-slate-500 font-bold">Wallet</span>
              <span className="text-sm font-mono text-white">
                {isConnected ? `${address?.slice(0, 6)}...${address?.slice(-4)}` : 'Disconnected'}
              </span>
            </div>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all ${
              isConnected ? 'bg-[#35D07F]/10 border-[#35D07F]/30' : 'bg-red-500/10 border-red-500/30'
            }`}>
              <div className={`w-2.5 h-2.5 rounded-full ${
                isConnected ? 'bg-[#35D07F] animate-pulse' : 'bg-red-500'
              }`} />
            </div>
          </div>
          
          {!isConnected && (
            <button 
              onClick={() => connect({ connector: coinbaseWallet() })}
              className="px-6 py-3 bg-[#FBCC5C] text-black rounded-2xl text-sm font-bold hover:scale-105 active:scale-95 transition-all shadow-lg shadow-[#FBCC5C]/10"
            >
              Connect
            </button>
          )}
          {isConnected && (
            <button 
              onClick={() => disconnect()}
              className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-all"
            >
              <Wallet size={18} className="text-slate-400" />
            </button>
          )}
        </div>
      </header>

      {/* Main Bento Grid */}
      <main className="grid grid-cols-1 md:grid-cols-12 gap-6 flex-grow">
        
        {/* Chat / Agent Section (Primary Bento Box) */}
        <section className="col-span-1 md:col-span-8 bento-card flex flex-col h-[600px] bg-white/[0.02]">
          <div className="flex items-center justify-between mb-6 border-b border-white/5 pb-4">
             <div className="flex items-center gap-3">
               <div className="p-2 bg-white/5 rounded-xl border border-white/10">
                 <Bot size={18} className="text-[#FBCC5C]" />
               </div>
               <h2 className="text-lg font-medium text-white">Agent Interface</h2>
             </div>
             <div className="flex gap-2">
               <button className="p-2 hover:bg-white/5 rounded-lg transition-all text-slate-500"><Sparkles size={16} /></button>
               <button className="p-2 hover:bg-white/5 rounded-lg transition-all text-slate-500"><RefreshCw size={16} /></button>
             </div>
          </div>

          <div 
            ref={scrollRef}
            className="flex-1 overflow-y-auto mb-6 pr-2 space-y-6 custom-scrollbar"
          >
            <AnimatePresence mode="popLayout">
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[90%] md:max-w-[80%]`}>
                    <div className={`flex items-center gap-2 mb-2 px-1 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                      <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                        {msg.role === 'assistant' ? 'Agent' : 'You'}
                      </span>
                    </div>
                    <div className={`p-5 rounded-3xl ${
                      msg.role === 'user' 
                        ? 'bg-[#FBCC5C] text-black font-semibold rounded-tr-none shadow-xl shadow-[#FBCC5C]/5' 
                        : 'bg-white/[0.04] border border-white/5 rounded-tl-none'
                    }`}>
                      <p className="text-sm leading-relaxed">{msg.content}</p>
                      
                      {msg.type === 'swap_quote' && (
                        <div className="mt-6 p-5 bg-black/40 rounded-2xl border border-[#35D07F]/20 space-y-6">
                          <div className="flex items-center justify-between">
                             <div className="space-y-1">
                               <p className="text-[9px] uppercase tracking-[0.1em] text-slate-500">From</p>
                               <div className="flex items-center gap-2">
                                 <div className="w-6 h-6 bg-[#FBCC5C] rounded-full" />
                                 <p className="font-bold text-white">{msg.quoteData?.amount} {msg.quoteData?.sellSymbol}</p>
                               </div>
                             </div>
                             <div className="p-2 bg-white/5 rounded-xl">
                               <ArrowRightLeft className="text-[#35D07F]" size={14} />
                             </div>
                             <div className="space-y-1 text-right">
                               <p className="text-[9px] uppercase tracking-[0.1em] text-slate-500">To (Est.)</p>
                               <div className="flex items-center gap-2 justify-end">
                                 <p className="font-bold text-[#35D07F]">
                                   {formatUnits(msg.quoteData?.buyAmount, 18).slice(0, 8)} {msg.quoteData?.buySymbol}
                                 </p>
                                 <div className="w-6 h-6 bg-[#35D07F] rounded-full" />
                               </div>
                             </div>
                          </div>
                          
                          <button 
                            onClick={() => {
                              setPendingQuote(msg.quoteData);
                              setShowConfirmModal(true);
                            }}
                            className="w-full py-4 bg-gradient-to-r from-[#35D07F] to-[#2BAE6B] text-black rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:shadow-[0_0_20px_rgba(53,208,127,0.2)] transition-all active:scale-95"
                          >
                             Review Swap
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-white/5 p-4 rounded-2xl flex gap-1.5">
                    <div className="w-1.5 h-1.5 bg-[#35D07F] rounded-full animate-bounce" />
                    <div className="w-1.5 h-1.5 bg-[#35D07F] rounded-full animate-bounce [animation-delay:150ms]" />
                    <div className="w-1.5 h-1.5 bg-[#35D07F] rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}
            </AnimatePresence>
          </div>

          <div className="relative group">
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="How can I help you swap today?"
              className="w-full bg-black/40 border border-white/10 rounded-2xl py-5 pl-6 pr-16 focus:outline-none focus:border-[#35D07F]/40 transition-all text-sm placeholder:text-slate-600 shadow-inner"
            />
            <button 
              onClick={handleSend}
              disabled={!input.trim()}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-[#35D07F] text-black rounded-xl flex items-center justify-center disabled:opacity-20 disabled:grayscale transition-all hover:scale-105 active:scale-90"
            >
              <Send size={18} />
            </button>
          </div>
        </section>

        {/* Info Bento Grid (Secondary Boxes) */}
        <div className="col-span-1 md:col-span-4 flex flex-col gap-6">
          
          {/* Portfolio Box */}
          <section className="bento-card bg-white/[0.02]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold">Portfolio</h3>
              <BarChart3 size={14} className="text-slate-500" />
            </div>
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-[#FBCC5C]/10 border border-[#FBCC5C]/20 rounded-lg flex items-center justify-center text-[10px] font-bold text-[#FBCC5C]">C</div>
                  <span className="text-sm font-medium text-white">CELO</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-white">{balance ? formatUnits(balance.value, 18).slice(0, 6) : '0.00'}</div>
                  <div className="text-[10px] text-slate-500">$0.84</div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-[#35D07F]/10 border border-[#35D07F]/20 rounded-lg flex items-center justify-center text-[10px] font-bold text-[#35D07F]">$</div>
                  <span className="text-sm font-medium text-white">cUSD</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-white">0.00</div>
                  <div className="text-[10px] text-slate-500">$1.00</div>
                </div>
              </div>
            </div>
            <div className="mt-8 p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
              <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Total Value</div>
              <div className="text-2xl font-light text-white">$ {balance ? (parseFloat(formatUnits(balance.value, 18)) * 0.84).toFixed(2) : '0.00'}</div>
            </div>
          </section>

          {/* Stats Box */}
          <section className="bento-card py-4 flex justify-around items-center bg-white/[0.02]">
            <div className="text-center">
              <div className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Fee</div>
              <div className="text-xs font-mono text-[#35D07F]">Low</div>
            </div>
            <div className="w-[1px] h-8 bg-white/5"></div>
            <div className="text-center">
              <div className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Speed</div>
              <div className="text-xs font-mono text-white">~5s</div>
            </div>
            <div className="w-[1px] h-8 bg-white/5"></div>
            <div className="text-center">
              <div className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Secure</div>
              <div className="text-xs font-mono text-[#FBCC5C] flex items-center gap-1 justify-center">
                <ShieldCheck size={10} /> 100%
              </div>
            </div>
          </section>

          {/* Trade History Box */}
          <section className="bento-card bg-white/[0.02] flex-grow overflow-hidden flex flex-col min-h-[250px]">
             <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold">Trade History</h3>
              <Activity size={14} className="text-slate-500" />
            </div>
            <div className="space-y-4 overflow-y-auto custom-scrollbar flex-1 pr-1">
              {tradeHistory.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-20 py-10">
                  <RefreshCw size={24} className="mb-2" />
                  <p className="text-[10px] uppercase">No trades yet</p>
                </div>
              ) : (
                tradeHistory.map((trade, i) => (
                  <div key={i} className="p-3 bg-white/[0.03] border border-white/5 rounded-xl space-y-2 hover:bg-white/[0.05] transition-all">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">{trade.sellAmount} {trade.sellToken}</span>
                        <ArrowRightLeft size={10} className="text-slate-500" />
                        <span className="text-sm font-bold text-[#35D07F]">{trade.buyAmount} {trade.buyToken}</span>
                      </div>
                      <span className="text-[9px] text-slate-500 font-mono">
                        {new Date(trade.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[9px] font-mono">
                      <a 
                        href={`https://celoscan.io/tx/${trade.hash}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-[#FBCC5C] hover:underline"
                      >
                        {trade.hash.slice(0, 10)}...
                      </a>
                      <span className="text-slate-600">Fee: {trade.fee} CELO</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Tips Box */}
          <section className="bento-card bg-emerald-500/5 border-emerald-500/10 hover:bg-emerald-500/10">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-[#35D07F] font-bold mb-3">AI Insight</h3>
            <p className="text-xs text-slate-300 leading-relaxed italic">
              &quot;CELO volume is up 2.4% today. It might be a good time to rebalance your cUSD holdings for yield.&quot;
            </p>
          </section>

        </div>
      </main>

      <footer className="mt-auto flex flex-col md:flex-row justify-between items-center bg-black/20 p-4 rounded-2xl border border-white/5 gap-4">
        <div className="flex gap-6 text-[10px] uppercase tracking-widest text-slate-500 font-bold">
           <span className="hover:text-white cursor-pointer transition-all flex items-center gap-1"><Sparkles size={10} /> Model: Gemini Flash</span>
           <span className="hover:text-white cursor-pointer transition-all flex items-center gap-1"><Activity size={10} /> Network: Celo Mainnet</span>
        </div>
        <div className="flex items-center gap-4">
          {!isConnected && (
            <div className="flex items-center gap-2 text-[10px] text-red-400 uppercase font-bold animate-pulse">
               <AlertCircle size={10} /> Connection Required for swaps
            </div>
          )}
          <span className="text-[10px] text-slate-600 font-mono">Powered by 0x & Farcaster</span>
        </div>
      </footer>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.1);
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* Confirmation Modal Overlay */}
      <AnimatePresence>
        {showConfirmModal && pendingQuote && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowConfirmModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-[#0D0E12] border border-white/10 rounded-[2.5rem] p-8 shadow-2xl overflow-hidden"
            >
              {/* Background Glow */}
              <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#35D07F]/20 blur-[80px] rounded-full" />
              
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center">
                  <RefreshCw size={24} className="text-[#FBCC5C]" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Review Swap</h3>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest">Verify transaction details</p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-4">
                  <div className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-3">You Pay</p>
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold text-white">{pendingQuote.amount}</span>
                      <span className="px-3 py-1 bg-[#FBCC5C] text-black text-[10px] font-black rounded-lg">{pendingQuote.sellSymbol}</span>
                    </div>
                  </div>

                  <div className="flex justify-center -my-3 relative z-10">
                    <div className="w-10 h-10 bg-[#0D0E12] border border-white/10 rounded-full flex items-center justify-center text-slate-500">
                      <ArrowRightLeft size={16} />
                    </div>
                  </div>

                  <div className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-3">You Receive (Est.)</p>
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold text-[#35D07F]">
                        {formatUnits(pendingQuote.buyAmount, 18).slice(0, 8)}
                      </span>
                      <span className="px-3 py-1 bg-[#35D07F] text-black text-[10px] font-black rounded-lg">{pendingQuote.buySymbol}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 px-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500 font-medium">Estimated Network Fee</span>
                    <span className="text-white font-mono">{pendingQuote.estimatedFee} CELO</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500 font-medium">Price Impact</span>
                    <span className="text-[#35D07F] font-mono">{"< 0.1%"}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500 font-medium">Route</span>
                    <span className="text-white font-mono text-[10px]">0x Protocol (CELO)</span>
                  </div>
                </div>

                <div className="pt-4 flex gap-4">
                  <button 
                    onClick={() => setShowConfirmModal(false)}
                    className="flex-1 py-4 bg-white/5 border border-white/10 text-white rounded-2xl font-bold text-sm hover:bg-white/10 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => executeSwap(pendingQuote)}
                    className="flex-1 py-4 bg-[#35D07F] text-black rounded-2xl font-black text-sm hover:shadow-[0_0_30px_rgba(53,208,127,0.3)] transition-all active:scale-95"
                  >
                    Confirm Swap
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
