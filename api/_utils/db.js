     import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
                persistSession: false,
                autoRefreshToken: false
      },
      db: {
                schema: 'public'
      }
});

export async function getTradingState() {
      const { data, error } = await supabase
          .from('trading_state')
          .select('*')
          .eq('id', 'main')
          .single();

    if (error) throw error;
      return data;
}
     export async function getOpenPosition() {
           const { data, error } = await supabase
               .from('positions')
               .select('*')
               .eq('status', 'OPEN')
               .maybeSingle();
           if (error) throw error;
           return data;
     }

export async function getRecentTrades(limit = 50) {
      const { data, error } = await supabase
          .from('trade_history')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit);
      if (error) throw error;
      return data;
}

export async function getPriceConsensus(symbol = 'BTC') {
      const { data, error } = await supabase
          .from('price_consensus')
          .select('*')
          .eq('symbol', symbol)
          .single();
      if (error) throw error;
      return data;
}
