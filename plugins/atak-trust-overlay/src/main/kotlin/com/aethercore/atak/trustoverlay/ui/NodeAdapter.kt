package com.aethercore.atak.trustoverlay.ui

import android.graphics.Color
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.aethercore.atak.trustoverlay.R
import com.aethercore.atak.trustoverlay.network.NodeSummary
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class NodeAdapter : ListAdapter<NodeSummary, NodeAdapter.NodeViewHolder>(DiffCallback()) {
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): NodeViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_node, parent, false)
        return NodeViewHolder(view)
    }

    override fun onBindViewHolder(holder: NodeViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    class NodeViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val nodeId: TextView = itemView.findViewById(R.id.nodeId)
        private val nodeStatus: TextView = itemView.findViewById(R.id.nodeStatus)
        private val nodeTrust: TextView = itemView.findViewById(R.id.nodeTrust)
        private val nodeLocation: TextView = itemView.findViewById(R.id.nodeLocation)
        private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.US)

        fun bind(node: NodeSummary) {
            nodeId.text = node.nodeId
            nodeStatus.text = "Status: ${node.status.uppercase(Locale.US)}"
            nodeTrust.text = "Trust: ${node.trustScore}%"
            nodeLocation.text = formatLocation(node)

            val trustColor = when {
                node.trustScore >= 85 -> Color.parseColor("#39FF14")
                node.trustScore >= 60 -> Color.parseColor("#FFAE00")
                else -> Color.parseColor("#FF2A2A")
            }
            nodeTrust.setTextColor(trustColor)

            val lastSeen = timeFormat.format(Date(node.lastSeen))
            nodeStatus.text = "Status: ${node.status.uppercase(Locale.US)} • ${lastSeen}"
        }

        private fun formatLocation(node: NodeSummary): String {
            val lat = node.latitude
            val lon = node.longitude
            if (lat == null || lon == null) {
                return "Location: --"
            }
            return String.format(Locale.US, "Location: %.5f, %.5f", lat, lon)
        }
    }

    private class DiffCallback : DiffUtil.ItemCallback<NodeSummary>() {
        override fun areItemsTheSame(oldItem: NodeSummary, newItem: NodeSummary): Boolean =
            oldItem.nodeId == newItem.nodeId

        override fun areContentsTheSame(oldItem: NodeSummary, newItem: NodeSummary): Boolean =
            oldItem == newItem
    }
}
