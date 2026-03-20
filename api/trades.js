     import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
    try {
          const limit = parseInt(req.query.limit) || 50;
          const { data, error } = await supabase
            .from('trade_history')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

      if (error) throw error;
          res.status(200).json(data);
    } catch (error) {
          res.status(500).json({ error: error.message });
    }
}
