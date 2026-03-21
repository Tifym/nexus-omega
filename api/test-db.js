import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  try {
    const posId = `pos_test_${Date.now()}`;
    
    // We try to insert a fake CANCELLED position to see if the table schema accepts all fields
    const { data, error } = await supabase.from('positions').insert({
      id: posId,
      side: 'LONG',
      entry_price: 70000,
      current_price: 70000,
      margin: 100,
      notional: 2000, // <--- This is the new column we added, might be missing in Supabase!
      leverage: 20,
      stop_loss: 69000,
      take_profit: 71000,
      unrealized_pnl: 0,
      status: 'CANCELLED', 
      entry_time: Date.now(),
      confidence: 90,
      signal_score: 50
    }).select();

    if (error) {
      return res.status(500).json({ error: error.message, details: error.details, hint: error.hint });
    }

    res.status(200).json({ success: true, message: "Insert worked perfectly!" });
  } catch (err) {
    res.status(500).json({ exception: err.message });
  }
}
