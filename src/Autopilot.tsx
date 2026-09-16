import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { isSandboxRequest, type SandboxState } from '../shared/autopilot';
import { api, copyText } from './api';
import { PageHead } from './components';
import './autopilot.css';
import simulatorHtml from '../public/simulator.html?raw';
import simulatorJs from '../public/simulator.js?raw';
import simulatorCss from '../public/simulator.css?raw';

export default function AutopilotPage() {
  const frame = useRef<HTMLIFrameElement>(null);
  const relayToken = useRef(crypto.randomUUID());
  const [embeddedDocument, setEmbeddedDocument] = useState('');
  const simulatorUrl = window.location.protocol === 'flowdesk:' ? `flowdesk://app/simulator.html?relay=${relayToken.current}` : undefined;
  useEffect(() => {
    let cancelled = false;
    const script = simulatorJs.replace(/\r\n/g, '\n');
    void crypto.subtle.digest('SHA-256', new TextEncoder().encode(script)).then(digest => {
      const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
      const html = simulatorHtml
        .replace('<head>', `<head><meta name="flowdesk-relay" content="${relayToken.current}">`)
        .replace("style-src 'self'; script-src 'self';", `style-src 'unsafe-inline'; script-src 'sha256-${hash}'; form-action 'none';`)
        .replace('<link rel="stylesheet" href="./simulator.css">', `<style>${simulatorCss}</style>`)
        .replace('<script src="./simulator.js" defer></script>', `<script>${script}</script>`);
      if (!cancelled) setEmbeddedDocument(html);
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let disposed = false;
    const relay = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (data?.channel === 'flowdesk-simulator-ready' && data.token === relayToken.current && event.origin === 'null' && data.version === 1 && data.conversationCount === 3 && data.parentAccessBlocked === true) {
        (window.flowdesk as (typeof window.flowdesk & { smokeSimulatorRelayReady?: () => void }) | undefined)?.smokeSimulatorRelayReady?.();
        return;
      }
      if (!data || data.token !== relayToken.current || data.channel !== 'flowdesk-simulator' || typeof data.id !== 'string' || data.id.length > 100) return;
      const respond = (value: object) => {
        if (!disposed && event.source === frame.current?.contentWindow) frame.current.contentWindow?.postMessage({ channel: 'flowdesk-simulator', token: relayToken.current, id: data.id, ...value }, '*');
      };
      try {
        const request = data.request;
        if (request?.method === 'POST' && request?.path === '/sandbox/clipboard') {
          const state = await api<SandboxState>('GET', '/sandbox/state');
          const job = state.jobs.find(item => item.id === request.body?.jobId && ['ready', 'copied'].includes(item.status));
          if (!job?.reply) throw new Error('没有可复制的模拟草稿。');
          await copyText(job.reply);
          respond({ result: job.status === 'copied' ? job : await api('POST', '/sandbox/copy', { jobId: job.id }) });
          return;
        }
        if (!isSandboxRequest(request)) throw new Error('模拟窗口只能访问测试消息接口。');
        const result = await api(request.method, request.path, request.body);
        respond({ result });
      } catch (error) { respond({ error: error instanceof Error ? error.message : '模拟操作失败' }); }
    };
    window.addEventListener('message', relay);
    return () => { disposed = true; window.removeEventListener('message', relay); };
  }, []);
  return <>
    <PageHead title="回复模式实验室" description="自动回复或人工复制，由你选择。这里使用独立的虚构聊天环境，验证完整消息流程。" actions={!window.flowdesk && <a className="btn btn-secondary" href="./simulator.html" target="_blank" rel="noreferrer">独立打开模拟器<ExternalLink size={15} /></a>} />
    <iframe ref={frame} className="autopilot-frame" title="FlowDesk 本地聊天模拟器" src={simulatorUrl} srcDoc={simulatorUrl ? undefined : embeddedDocument} sandbox="allow-scripts allow-forms" />
    <p className="autopilot-note">测试状态与正式工作区分开保存。自动回复在此模拟器中运行；真实账户与 Windows 客户端的适配状态不由模拟发送结果代替。</p>
  </>;
}
