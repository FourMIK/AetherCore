package com.aethercore.atak.trustoverlay.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import kotlin.math.roundToInt

class GatewayClient(
    private val baseUrl: String,
    private val httpClient: OkHttpClient = OkHttpClient(),
) {
    suspend fun fetchNodes(): List<NodeSummary> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/api/nodes")
            .get()
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("Gateway /api/nodes failed: HTTP ${response.code}")
            }
            val body = response.body?.string() ?: "{}"
            val json = JSONObject(body)
            val nodesJson = json.optJSONArray("nodes") ?: JSONArray()
            (0 until nodesJson.length()).mapNotNull { index ->
                parseNode(nodesJson.optJSONObject(index))
            }
        }
    }

    private fun parseNode(node: JSONObject?): NodeSummary? {
        if (node == null) return null
        val nodeId = node.optString("node_id", "unknown")
        val lastSeen = node.optLong("last_seen", System.currentTimeMillis())
        val telemetry = node.optJSONObject("telemetry") ?: node.optJSONObject("data")
        val trust = telemetry?.optJSONObject("trust") ?: node.optJSONObject("trust")
        val identity = telemetry?.optJSONObject("identity") ?: node.optJSONObject("identity")
        val security = telemetry?.optJSONObject("security") ?: node.optJSONObject("security")
        val gps = telemetry?.optJSONObject("gps") ?: telemetry?.optJSONObject("location")

        val trustScore = normalizeTrustScore(
            trust?.optDouble("self_score")
                ?: trust?.optDouble("score")
                ?: node.optDouble("trust_score")
        )

        val status = telemetry?.optString("status")
            ?: telemetry?.optString("state")
            ?: node.optString("status", "online")

        val latitude = readDoubleCandidate(
            gps?.optDouble("lat"),
            gps?.optDouble("latitude"),
            telemetry?.optDouble("lat"),
            telemetry?.optDouble("latitude")
        )

        val longitude = readDoubleCandidate(
            gps?.optDouble("lon"),
            gps?.optDouble("longitude"),
            telemetry?.optDouble("lon"),
            telemetry?.optDouble("longitude")
        )

        val hardwareBacked = readBooleanCandidate(
            security?.optBoolean("hardware_backed"),
            security?.optBoolean("tpm_backed"),
            identity?.optBoolean("hardware_backed"),
            identity?.optBoolean("tpm_backed")
        ) ?: false

        val verified = hardwareBacked || trustScore >= 90

        return NodeSummary(
            nodeId = nodeId,
            trustScore = trustScore,
            status = status,
            lastSeen = lastSeen,
            latitude = latitude,
            longitude = longitude,
            hardwareBacked = hardwareBacked,
            verified = verified,
        )
    }

    private fun readBooleanCandidate(vararg values: Boolean?): Boolean? {
        for (value in values) {
            if (value != null) return value
        }
        return null
    }

    private fun readDoubleCandidate(vararg values: Double?): Double? {
        for (value in values) {
            if (value != null && value.isFinite()) return value
        }
        return null
    }

    private fun normalizeTrustScore(value: Double?): Int {
        val raw = value ?: 0.0
        val percent = if (raw <= 1.0) raw * 100.0 else raw
        return percent.coerceIn(0.0, 100.0).roundToInt()
    }
}
