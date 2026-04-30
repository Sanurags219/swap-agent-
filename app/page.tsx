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
  const scrollRef = useRef<HTMLDivElement>(null);

  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address });
  const { sendTransactionAsync } = useSendTransaction();

  // Initialize Farcaster SDK
  useEffect(() => {
    const init = async () => {
      await sdk.actions.ready();
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
              
              Task: Analyze the intent. If it's a swap request, return a JSON object with:
              {
                "type": "swap_request",
                "sellToken": "token symbol",
                "buyToken": "token symbol",
                "sellAmount": "number"
              }
              Otherwise, return a friendly text response.
              Only return JSON if it's clearly a swap.
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
        fetchQuote(data.sellToken, data.buyToken, data.sellAmount);
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

  const fetchQuote = async (sellSymbol: string, buySymbol: string, amount: string) => {
    const sellToken = TOKENS[sellSymbol.toUpperCase()];
    const buyToken = TOKENS[buySymbol.toUpperCase()];

    if (!sellToken || !buyToken) {
      setMessages(prev => [...prev, { role: 'assistant', content: `I don't support ${sellSymbol} or ${buySymbol} yet. I currently support CELO, cUSD, and cEUR.` }]);
      return;
    }

    try {
      setIsTyping(true);
      const url = `https://celo.api.0x.org/swap/v1/quote?sellToken=${sellToken}&buyToken=${buyToken}&sellAmount=${parseEther(amount).toString()}`;
      const res = await fetch(url);
      const quote = await res.json();

      if (quote.error) throw new Error(quote.reason || 'Failed to fetch quote');

      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `I found a quote! You'll receive approx. ${formatUnits(quote.buyAmount, 18).slice(0, 8)} ${buySymbol.toUpperCase()} for ${amount} ${sellSymbol.toUpperCase()}.`,
        type: 'swap_quote',
        quoteData: { ...quote, sellSymbol, buySymbol, amount }
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
      const tx = await sendTransactionAsync({
        to: quote.to as `0x${string}`,
        data: quote.data as `0x${string}`,
        value: BigInt(quote.value),
      });

      setMessages(prev => [...prev, { role: 'assistant', content: `Swap transaction sent! Hash: ${tx.substring(0, 10)}...` }]);
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
                            onClick={() => executeSwap(msg.quoteData)}
                            className="w-full py-4 bg-gradient-to-r from-[#35D07F] to-[#2BAE6B] text-black rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:shadow-[0_0_20px_rgba(53,208,127,0.2)] transition-all active:scale-95"
                          >
                             Execute Swap
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

          {/* Tips Box */}
          <section className="bento-card bg-emerald-500/5 border-emerald-500/10 hover:bg-emerald-500/10">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-[#35D07F] font-bold mb-3">AI Insight</h3>
            <p className="text-xs text-slate-300 leading-relaxed italic">
              "CELO volume is up 2.4% today. It might be a good time to rebalance your cUSD holdings for yield."
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
    </div>
  );
}
